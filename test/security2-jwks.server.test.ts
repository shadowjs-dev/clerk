import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateRequest } from "../src/server/authenticate";
import {
  admit,
  guardSizes,
  MAX_TOKEN_LENGTH,
  resetGuard,
  UNKNOWN_KID_BUDGET,
  WINDOW_MS,
} from "../src/server/request-guard";
import {
  APP,
  b64u,
  bearer,
  LIVE_PUBLISHABLE_KEY,
  makeKeys,
  publishableKeyFor,
  sessionToken,
  type TestKeys,
} from "./support/sec2-server";

/**
 * PASS 2, scope A (Clerk), the key set. Without `jwtKey`, `@clerk/backend` fetches Clerk's JWKS from the Backend
 * API with the secret key. `fetch` is replaced by a stub that records every call; nothing reaches the network.
 */

let real: TestKeys;
let attacker: TestKeys;

beforeAll(() => {
  real = makeKeys("ins_real");
  attacker = makeKeys("ins_real");
});

interface Call {
  readonly url: string;
  readonly authorization: string | undefined;
}

let calls: Call[] = [];
/** What the stubbed Backend API answers: the JWKS of this instance. */
let jwks: () => unknown;

beforeEach(() => {
  calls = [];
  jwks = () => ({ keys: [real.jwk] });
  resetGuard();
  vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), authorization: init?.headers?.["Authorization"] });
    return new Response(JSON.stringify(jwks()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

let instance = 0;
/** Options for an instance no other test uses: the backend caches key sets per secret key. */
function remote(publishableKey = LIVE_PUBLISHABLE_KEY) {
  instance += 1;
  return {
    secretKey: `sk_live_sec2_jwks_instance_${instance}_value`,
    publishableKey,
    authorizedParties: [APP],
  };
}

const withKid = (kid: string, signer: TestKeys = real): string => sessionToken(signer, {}, { kid });

describe("SEC2-CLERK-3x where the key set comes from", () => {
  it.each([
    ["an internal address", "169.254.169.254"],
    ["localhost-like name", "localhost.localdomain"],
    ["a private IP", "10.0.0.5"],
    ["an attacker host", "evil.example"],
    ["a host with a port", "evil.example:8443"],
    ["a host with a path", "evil.example/jwks"],
    ["a host with userinfo", "user@evil.example"],
  ])(
    "[SEC2-CLERK-33] a publishable key naming %s does not change where the key set is fetched from",
    async (_name, host) => {
      const options = remote(publishableKeyFor(host));
      await authenticateRequest(bearer(withKid("ins_real")), options).catch((error: unknown) => {
        // A key that does not decode to a Clerk frontend API is refused by the backend; either way no fetch goes out.
        expect(String(error)).toMatch(/ublishable/i);
      });
      for (const call of calls) {
        expect(call.url).toBe("https://api.clerk.com/v1/jwks");
      }
      // The secret key is sent to the Backend API and to no other host.
      expect(calls.every((call) => call.url.startsWith("https://api.clerk.com/"))).toBe(true);
    },
  );

  it("[SEC2-CLERK-34] the key set is fetched once for a stream of valid tokens, and the key verifies them", async () => {
    const options = remote();
    for (let i = 0; i < 25; i += 1) {
      const auth = await authenticateRequest(bearer(withKid("ins_real")), options);
      expect(auth.isSignedIn).toBe(true);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.authorization?.startsWith("Bearer sk_live_")).toBe(true);
  });

  it("[SEC2-CLERK-35] a token signed by someone else with the real key id is refused, and cannot replace the cached key", async () => {
    const options = remote();
    expect((await authenticateRequest(bearer(withKid("ins_real")), options)).isSignedIn).toBe(true);
    const forged = await authenticateRequest(bearer(withKid("ins_real", attacker)), options);
    expect(forged.isSignedIn).toBe(false);
    expect(forged.reason).toBe("token-invalid-signature");
    // The real key still verifies afterward: nothing in a request writes to the cache.
    expect((await authenticateRequest(bearer(withKid("ins_real")), options)).isSignedIn).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("[SEC2-CLERK-36] two instances keep their own key sets even when they use the same key id", async () => {
    const a = remote();
    const b = remote();
    jwks = () => ({ keys: [real.jwk] });
    expect((await authenticateRequest(bearer(withKid("ins_real")), a)).isSignedIn).toBe(true);
    // Instance b's Clerk has a different key under the same id.
    jwks = () => ({ keys: [attacker.jwk] });
    expect((await authenticateRequest(bearer(withKid("ins_real")), b)).isSignedIn).toBe(false);
    expect((await authenticateRequest(bearer(withKid("ins_real", attacker)), b)).isSignedIn).toBe(
      true,
    );
    expect((await authenticateRequest(bearer(withKid("ins_real")), a)).isSignedIn).toBe(true);
  });

  it.each([
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "__defineGetter__",
  ])(
    "[SEC2-CLERK-37] the key id %s is data, not a property of the cache: signed out, no throw",
    async (kid) => {
      const options = remote();
      expect((await authenticateRequest(bearer(withKid("ins_real")), options)).isSignedIn).toBe(
        true,
      );
      const auth = await authenticateRequest(bearer(withKid(kid)), options);
      expect(auth.isSignedIn).toBe(false);
      expect(auth.userId).toBeNull();
    },
  );
});

describe("SEC2-CLERK-4x unknown key ids cannot make the server call Clerk without limit", () => {
  it("[SEC2-CLERK-38] a stream of tokens with fresh random key ids causes at most a few key-set fetches", async () => {
    const options = remote();
    expect((await authenticateRequest(bearer(withKid("ins_real")), options)).isSignedIn).toBe(true);
    const before = calls.length;
    const reasons = new Set<string | null>();
    for (let i = 0; i < 60; i += 1) {
      const auth = await authenticateRequest(bearer(withKid(`random_${i}`)), options);
      expect(auth.isSignedIn).toBe(false);
      reasons.add(auth.reason);
    }
    expect(calls.length - before).toBeLessThanOrEqual(UNKNOWN_KID_BUDGET);
    expect(reasons).toContain("jwks-lookup-refused");
  });

  it("[SEC2-CLERK-39] one unknown key id repeated costs one fetch, then is refused for the window", async () => {
    const options = remote();
    await authenticateRequest(bearer(withKid("ins_real")), options);
    const before = calls.length;
    for (let i = 0; i < 30; i += 1) {
      await authenticateRequest(bearer(withKid("same_unknown")), options);
    }
    expect(calls.length - before).toBe(1);
  });

  it("[SEC2-CLERK-40] a valid token keeps working while the budget is spent, and the budget returns after the window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    const options = remote();
    expect((await authenticateRequest(bearer(withKid("ins_real")), options)).isSignedIn).toBe(true);
    for (let i = 0; i < 20; i += 1)
      await authenticateRequest(bearer(withKid(`flood_${i}`)), options);
    // The known key id is not charged.
    expect((await authenticateRequest(bearer(withKid("ins_real")), options)).isSignedIn).toBe(true);
    // A key rotation during the flood waits for the window, then the first request with the new key id works.
    const rotated = makeKeys("ins_rotated");
    jwks = () => ({ keys: [real.jwk, rotated.jwk] });
    expect(
      (await authenticateRequest(bearer(withKid("ins_rotated", rotated)), options)).isSignedIn,
    ).toBe(false);
    vi.setSystemTime(1_800_000_000_000 + WINDOW_MS + 1);
    expect(
      (await authenticateRequest(bearer(withKid("ins_rotated", rotated)), options)).isSignedIn,
    ).toBe(true);
  });

  it("[SEC2-CLERK-41] a request that names an unknown key id in a cookie while its bearer token is valid cannot make that key id known", async () => {
    const options = remote();
    const request = new Request(`${APP}/api`, {
      headers: {
        authorization: `Bearer ${withKid("ins_real")}`,
        cookie: `__session=${withKid("poison")}; __client_uat=1`,
      },
    });
    expect((await authenticateRequest(request, options)).isSignedIn).toBe(true);
    // "poison" was never verified: it still costs a lookup (one fetch) and is then refused, like any unknown id.
    const before = calls.length;
    for (let i = 0; i < 10; i += 1) await authenticateRequest(bearer(withKid("poison")), options);
    expect(calls.length - before).toBeLessThanOrEqual(1);
  });

  it("[SEC2-CLERK-42] the guard's tables are bounded: instances, known key ids and refused key ids", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_800_000_000_000);
    // Many instances: the oldest are dropped.
    for (let i = 0; i < 40; i += 1) {
      admit(bearer(withKid(`kid_${i}`)), `pk_live_scope_${i}`, true).done(
        false,
        "jwk-kid-mismatch",
        null,
      );
    }
    expect(guardSizes().instances).toBeLessThanOrEqual(8);
    // Many verified key ids in one instance, and many refused ones across windows.
    resetGuard();
    for (let i = 0; i < 100; i += 1) {
      const token = withKid(`known_${i}`);
      admit(bearer(token), "pk_live_one", true).done(true, null, token);
      vi.setSystemTime(1_800_000_000_000 + (i + 1) * (WINDOW_MS + 1));
    }
    const sizes = guardSizes();
    expect(sizes.known).toBeLessThanOrEqual(16);
    for (let i = 0; i < 200; i += 1) {
      admit(bearer(withKid(`refused_${i}`)), "pk_live_one", true).done(
        false,
        "jwk-kid-mismatch",
        null,
      );
      vi.setSystemTime(1_900_000_000_000 + (i + 1) * (WINDOW_MS + 1));
    }
    expect(guardSizes().refused).toBeLessThanOrEqual(64);
  });

  it("[SEC2-CLERK-43] work per request is bounded: a long key id is cut, a token over the limit is refused, junk is skipped", () => {
    const longKid = "k".repeat(3000);
    const header = b64u({ alg: "RS256", kid: longKid });
    const token = `${header}.${b64u({})}.AAAA`;
    // The header is longer than the read limit, so it names no key id and takes no lookup.
    expect(header.length).toBeGreaterThan(2048);
    expect(admit(bearer(token), "pk_live_bound", true).reason).toBeNull();
    expect(guardSizes().known).toBe(0);
    const tooLarge = `${b64u({ alg: "RS256" })}.${"A".repeat(MAX_TOKEN_LENGTH)}.AAAA`;
    expect(admit(bearer(tooLarge), "pk_live_bound", true).reason).toBe("token-too-large");
  });
});
