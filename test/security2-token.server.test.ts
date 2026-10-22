import { createHmac } from "node:crypto";
import fc from "fast-check";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { authenticateRequest } from "../src/server/authenticate";
import { checkServerOptions } from "../src/server/options";
import {
  APP,
  b64u,
  bearer,
  hmacToken,
  ISSUER,
  LIVE_PUBLISHABLE_KEY,
  LIVE_SECRET_KEY,
  makeKeys,
  signParts,
  type TestKeys,
  validClaims,
} from "./support/sec2-server";

/**
 * PASS 2, scope A (Clerk), token verification. The real `@clerk/backend` verifies tokens signed here; the public
 * key is `jwtKey`, so no request leaves the test.
 */

let keys: TestKeys;
let otherKeys: TestKeys;

beforeAll(() => {
  keys = makeKeys();
  otherKeys = makeKeys();
});

afterEach(() => {
  vi.useRealTimers();
});

const options = () => ({
  secretKey: LIVE_SECRET_KEY,
  publishableKey: LIVE_PUBLISHABLE_KEY,
  authorizedParties: [APP],
  jwtKey: keys.publicPem,
});

/** A token signed by `signer` with RS256 over `claims`, the header being `header`. */
function token(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
  signer: TestKeys = keys,
): string {
  return signParts(
    { alg: "RS256", typ: "JWT", kid: "ins_test", ...header },
    claims,
    signer.privateKey,
  );
}

async function verdict(
  text: string,
  override: Record<string, unknown> = {},
): Promise<{ signedIn: boolean; reason: string | null; userId: string | null }> {
  const auth = await authenticateRequest(bearer(text), { ...options(), ...override });
  return { signedIn: auth.isSignedIn, reason: auth.reason, userId: auth.userId };
}

describe("SEC2-CLERK-1x algorithm and key confusion", () => {
  it("[SEC2-CLERK-15] a token with alg none, in any spelling, is refused", async () => {
    for (const alg of ["none", "None", "NONE", "nOnE", "", "null"]) {
      const text = `${b64u({ alg, typ: "JWT", kid: "ins_test" })}.${b64u(validClaims())}.`;
      expect((await verdict(text)).signedIn, alg).toBe(false);
      const withSignature = `${b64u({ alg, typ: "JWT" })}.${b64u(validClaims())}.AAAA`;
      expect((await verdict(withSignature)).signedIn, alg).toBe(false);
    }
  });

  it("[SEC2-CLERK-16] an HMAC token keyed with the public key, in every form the key takes, is refused", async () => {
    // The classic confusion: the verifier treats the public key as an HMAC secret.
    const der = Buffer.from(
      keys.publicPem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s/g, ""),
      "base64",
    );
    const secrets: Array<string | Buffer> = [
      keys.publicPem,
      keys.publicPem.trim(),
      der,
      der.toString("base64"),
      JSON.stringify(keys.jwk),
      String(keys.jwk["n"]),
    ];
    for (const secret of secrets) {
      for (const alg of ["HS256", "HS384", "HS512"]) {
        const data = `${b64u({ alg, typ: "JWT", kid: "ins_test" })}.${b64u(validClaims())}`;
        const hash = `sha${alg.slice(2)}`;
        const signature = createHmac(hash, secret).update(data).digest("base64url");
        expect((await verdict(`${data}.${signature}`)).signedIn, alg).toBe(false);
      }
    }
    expect((await verdict(hmacToken(keys.publicPem, validClaims()))).reason).toBe(
      "token-invalid-algorithm",
    );
  });

  it("[SEC2-CLERK-17] only RS256 verifies against the instance key: another RSA hash, a wrong type or a malformed alg is refused", async () => {
    const claims = validClaims();
    const rs384 = signParts({ alg: "RS384", typ: "JWT" }, claims, keys.privateKey, "RSA-SHA384");
    expect((await verdict(rs384)).signedIn).toBe(false);
    const relabeled = token(claims, { alg: "RS512" });
    expect((await verdict(relabeled)).signedIn).toBe(false);
    for (const alg of [
      ["RS256"],
      { alg: "RS256" },
      256,
      null,
      true,
      "RS256 ",
      "rs256",
      "PS256",
      "ES256",
      "EdDSA",
    ]) {
      expect((await verdict(token(claims, { alg }))).signedIn, JSON.stringify(alg)).toBe(false);
    }
    expect((await verdict(token(claims, { typ: "at+jwt" }))).signedIn).toBe(false);
    expect((await verdict(token(claims))).signedIn).toBe(true);
  });

  it("[SEC2-CLERK-17a] a machine-token category in the header is not a session token", async () => {
    expect((await verdict(token(validClaims(), { cat: "cl_B7d4PD333AAA" }))).signedIn).toBe(false);
    expect((await verdict(token(validClaims(), { cat: "cl_B7d4PD111AAA" }))).signedIn).toBe(true);
  });

  it("[SEC2-CLERK-18] with jwtKey the signature decides: the key id is not trusted, whether it is missing, wrong or hostile", async () => {
    for (const header of [
      {},
      { kid: undefined },
      { kid: "other" },
      { kid: "__proto__" },
      { kid: ["a"] },
      { kid: 7 },
    ]) {
      expect((await verdict(token(validClaims(), header))).signedIn, JSON.stringify(header)).toBe(
        true,
      );
      expect(
        (await verdict(token(validClaims(), header, otherKeys))).signedIn,
        JSON.stringify(header),
      ).toBe(false);
    }
  });

  it("[SEC2-CLERK-19] a jwk or jku header inside the token does not replace the configured key", async () => {
    const attacker = otherKeys.jwk;
    const text = token(
      validClaims(),
      {
        jwk: attacker,
        jku: "https://evil.example/jwks",
        x5u: "https://evil.example/c",
        kid: "attacker",
      },
      otherKeys,
    );
    expect((await verdict(text)).signedIn).toBe(false);
  });
});

describe("SEC2-CLERK-2x claims and time", () => {
  const T = 1_800_000_000;

  /** Verifies a token at the fixed instant T. */
  async function at(claims: Record<string, unknown>, override: Record<string, unknown> = {}) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T * 1000);
    return verdict(token({ ...validClaims(), ...claims }), override);
  }

  it("[SEC2-CLERK-20] the clock skew is five seconds and no more, on exp, nbf and iat", async () => {
    // exp: expired once it is five seconds in the past.
    expect((await at({ exp: T - 4, iat: T - 60, nbf: T - 60 })).signedIn).toBe(true);
    expect((await at({ exp: T - 5, iat: T - 60, nbf: T - 60 })).signedIn).toBe(false);
    // nbf: not yet valid when more than five seconds ahead.
    expect((await at({ exp: T + 60, iat: T - 60, nbf: T + 5 })).signedIn).toBe(true);
    expect((await at({ exp: T + 60, iat: T - 60, nbf: T + 6 })).reason).toBe("session-token-nbf");
    // iat: issued in the future by more than five seconds.
    expect((await at({ exp: T + 60, nbf: T - 60, iat: T + 5 })).signedIn).toBe(true);
    expect((await at({ exp: T + 60, nbf: T - 60, iat: T + 6 })).reason).toBe(
      "session-token-iat-in-the-future",
    );
  });

  it("[SEC2-CLERK-21] a caller cannot widen the skew: unknown options are not passed to the verifier", async () => {
    const wide = { clockSkewInMs: 10 ** 12 };
    expect((await at({ exp: T - 3600, iat: T - 7200, nbf: T - 7200 }, wide)).signedIn).toBe(false);
    expect((await at({ exp: T + 60, nbf: T + 3600, iat: T }, wide)).signedIn).toBe(false);
  });

  it("[SEC2-CLERK-22] a token far in the future or the past is judged by the same bounds", async () => {
    expect((await at({ nbf: T + 10 ** 9, exp: T + 2 * 10 ** 9, iat: T })).signedIn).toBe(false);
    expect((await at({ nbf: 0, iat: 0, exp: 1 })).signedIn).toBe(false);
    // A far-future exp is valid when Clerk signed it; the lifetime is Clerk's to set.
    expect((await at({ exp: T + 10 ** 8 })).signedIn).toBe(true);
  });

  it("[SEC2-CLERK-23] claims of the wrong type are refused: exp, nbf, iat, sub", async () => {
    for (const claims of [
      { exp: String(T + 60) },
      { exp: null },
      { exp: [T + 60] },
      { exp: undefined },
      { nbf: String(T - 60) },
      { iat: String(T) },
      { sub: undefined },
      { sub: 7 },
      { sub: { id: "user_1" } },
    ]) {
      expect((await at(claims)).signedIn, JSON.stringify(claims)).toBe(false);
    }
  });

  it("[SEC2-CLERK-24] azp: a missing, different, differently cased, padded or array value is refused when origins are listed", async () => {
    for (const azp of [
      undefined,
      "https://evil.example",
      "HTTPS://APP.EXAMPLE.COM",
      `${APP}/`,
      ` ${APP}`,
      `${APP}\n`,
      [APP],
      { 0: APP },
    ]) {
      expect((await at({ azp })).signedIn, JSON.stringify(azp)).toBe(false);
    }
    expect((await at({ azp: APP })).signedIn).toBe(true);
    const listed = { authorizedParties: ["https://other.example", APP] };
    expect((await at({ azp: APP }, listed)).signedIn).toBe(true);
  });

  it("[SEC2-CLERK-25] an empty authorizedParties list is refused, not read as no list", async () => {
    // @clerk/backend skips the azp check for an empty list, so [] would pass the sk_live_ rule and accept a token
    // minted for any application of the instance.
    expect(() => checkServerOptions({ ...options(), authorizedParties: [] })).toThrow(
      /authorizedParties/,
    );
    await expect(
      authenticateRequest(bearer(token({ ...validClaims(), azp: "https://evil.example" })), {
        ...options(),
        authorizedParties: [],
      }),
    ).rejects.toThrow(/authorizedParties/);
  });

  it("[SEC2-CLERK-26] organization claims come from the claim the token version defines, not from any claim of that name", async () => {
    const spoof = {
      org_id: "org_evil",
      org_role: "org:admin",
      org_slug: "evil",
      org_permissions: ["org:*"],
    };
    // v2: only `o` counts.
    const v2 = await authenticateRequest(
      bearer(token({ ...validClaims(), v: 2, ...spoof })),
      options(),
    );
    expect(v2.isSignedIn).toBe(true);
    expect(v2.orgId).toBeNull();
    expect(v2.orgRole).toBeNull();
    // v1 (no v): only the top-level claims count, and `o` does not.
    const v1 = await authenticateRequest(
      bearer(token({ ...validClaims(), v: undefined, o: { id: "org_o", rol: "admin" } })),
      options(),
    );
    expect(v1.isSignedIn).toBe(true);
    expect(v1.orgId).toBeNull();
    // A version the parser does not know is read as v1: `o` stays ignored.
    const v3 = await authenticateRequest(
      bearer(token({ ...validClaims(), v: 3, o: { id: "org_o" } })),
      options(),
    );
    expect(v3.orgId).toBeNull();
    // The role gets the org: prefix once, from the v2 claim.
    const real = await authenticateRequest(
      bearer(token({ ...validClaims(), o: { id: "org_9", rol: "member" }, ...spoof })),
      options(),
    );
    expect(real.orgId).toBe("org_9");
    expect(real.orgRole).toBe("org:member");
  });

  it("[SEC2-CLERK-27] fuzz: random claim shapes never make a token signed-in unless exp, sub and azp are what the verifier needs", async () => {
    const anything = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.integer(),
      fc.string({ maxLength: 12 }),
      fc.boolean(),
      fc.array(fc.integer(), { maxLength: 2 }),
      fc.constantFrom(APP, "user_1"),
    );
    let signedIn = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.record({ exp: anything, nbf: anything, iat: anything, sub: anything, azp: anything }),
        async (claims) => {
          const outcome = await at(claims);
          if (outcome.signedIn) {
            signedIn += 1;
            expect(typeof claims.exp).toBe("number");
            expect(typeof claims.sub).toBe("string");
            expect(claims.azp).toBe(APP);
          }
        },
      ),
      { seed: 20261010, numRuns: 150 },
    );
    expect(signedIn).toBeGreaterThanOrEqual(0);
  });
});

describe("SEC2-CLERK-2x/3x malformed and oversized tokens", () => {
  it("[SEC2-CLERK-28] malformed base64, JSON and structure give signed out, not a throw", async () => {
    const good = token(validClaims());
    const [header = "", payload = "", signature = ""] = good.split(".");
    const cases = [
      "",
      ".",
      "..",
      "a.b",
      "a.b.c.d",
      `${header}.${payload}`,
      `${header}.${payload}.`,
      `!!!.${payload}.${signature}`,
      `${header}.!!!.${signature}`,
      `${header}.${payload}.!!!`,
      `${b64u("not json")}.${payload}.${signature}`,
      `${b64u("[]")}.${payload}.${signature}`,
      `${b64u("null")}.${payload}.${signature}`,
      `${header}.${b64u("null")}.${signature}`,
      `${header}.${b64u("[1,2]")}.${signature}`,
      `${header}.${b64u('"str"')}.${signature}`,
      `${Buffer.from([0xff, 0xfe, 0x00]).toString("base64url")}.${payload}.${signature}`,
      `${header}.${payload}.${signature}.extra`,
      `Bearer ${good}`,
    ];
    for (const text of cases) {
      const outcome = await verdict(text);
      expect(outcome.signedIn, text.slice(0, 40)).toBe(false);
    }
  });

  it("[SEC2-CLERK-29] fuzz: arbitrary token text never throws and never signs a request in", async () => {
    const alphabet = fc.string({
      unit: fc.constantFrom(...'abcXYZ019-_=.+/ \u0000é{}[]":,'),
      maxLength: 80,
    });
    await fc.assert(
      fc.asyncProperty(alphabet, alphabet, alphabet, async (a, b, c) => {
        for (const text of [`${a}.${b}.${c}`, a, `${b64u(a)}.${b64u(b)}.${c}`]) {
          const request = new Request(`${APP}/api`, {
            headers: { cookie: `__session=${encodeURIComponent(text)}; __client_uat=1` },
          });
          const auth = await authenticateRequest(request, options());
          expect(auth.isSignedIn).toBe(false);
        }
      }),
      { seed: 20261010, numRuns: 120 },
    );
    vi.mocked(console.error).mockClear();
  });

  it("[SEC2-CLERK-30] a token longer than 16 KiB, as a bearer or a cookie, is refused before it is decoded", async () => {
    const oversized = `${b64u({ alg: "RS256", typ: "JWT" })}.${"A".repeat(16 * 1024)}.AAAA`;
    const viaHeader = await authenticateRequest(bearer(oversized), options());
    expect(viaHeader.isSignedIn).toBe(false);
    expect(viaHeader.reason).toBe("token-too-large");
    const viaCookie = await authenticateRequest(
      new Request(`${APP}/api`, { headers: { cookie: `__session=${oversized}; __client_uat=1` } }),
      options(),
    );
    expect(viaCookie.reason).toBe("token-too-large");
    const viaUrl = await authenticateRequest(
      new Request(`${APP}/api?__clerk_handshake=${oversized}`, {
        headers: { accept: "text/html" },
      }),
      options(),
    );
    expect(viaUrl.reason).toBe("token-too-large");
    const hugeCookies = await authenticateRequest(
      new Request(`${APP}/api`, { headers: { cookie: `a=${"b".repeat(70 * 1024)}` } }),
      options(),
    );
    expect(hugeCookies.reason).toBe("token-too-large");
  });

  it("[SEC2-CLERK-31] a real session token with a long custom claim set still verifies", async () => {
    const big = token({ ...validClaims(), custom: "x".repeat(3000) });
    expect(big.length).toBeLessThan(16 * 1024);
    expect((await verdict(big)).signedIn).toBe(true);
  });

  it("[SEC2-CLERK-32] the issuer is not checked by the backend; the key is what ties a token to this instance", async () => {
    // Documented as it is: `iss` is not compared with the publishable key's host by @clerk/backend, so a token
    // signed by this instance's key is accepted whatever it claims. A token signed by another instance's key is not.
    expect(
      (await verdict(token({ ...validClaims(), iss: "https://other.example" }))).signedIn,
    ).toBe(true);
    expect((await verdict(token({ ...validClaims(), iss: ISSUER }, {}, otherKeys))).signedIn).toBe(
      false,
    );
  });
});
