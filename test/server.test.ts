import { createPrivateKey, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  authenticateRequest,
  type ClerkServerOptions,
  clerkMiddleware,
  getAuth,
  requireAuth,
} from "../src/server";

/**
 * Server tests run the real `@clerk/backend` against tokens signed here with throwaway RSA keys.
 * The public key goes in as `jwtKey`, so verification is local and no request leaves the test.
 * The keys are `pk_live_` / `sk_live_` shaped so the backend skips the development-browser handshake.
 */

const ISSUER = "https://clerk.example.com";
const FRONTEND_API = "clerk.example.com$";
const PUBLISHABLE_KEY = `pk_live_${Buffer.from(FRONTEND_API).toString("base64")}`;
const SECRET_KEY = "sk_live_test_secret_value_do_not_log";
const APP = "https://app.example.com";

let signingKey: KeyObject;
let otherKey: KeyObject;
let publicPem: string;

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  signingKey = createPrivateKey(pair.privateKey);
  publicPem = pair.publicKey;
  const other = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  otherKey = createPrivateKey(other.privateKey);
});

const now = (): number => Math.floor(Date.now() / 1000);

/** base64url of a string or a JSON value. */
function b64u(value: string | object): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(text).toString("base64url");
}

/** Signs `claims` as a session token. Defaults are a valid, current session for APP. */
function sign(claims: Record<string, unknown> = {}, key: KeyObject = signingKey): string {
  const header = { alg: "RS256", typ: "JWT", kid: "ins_test" };
  const body = {
    v: 2,
    azp: APP,
    sub: "user_123",
    sid: "sess_123",
    iss: ISSUER,
    nbf: now() - 10,
    iat: now(),
    exp: now() + 60,
    ...claims,
  };
  const data = `${b64u(header)}.${b64u(body)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  return `${data}.${signer.sign(key).toString("base64url")}`;
}

/** A request that presents `token` in the Authorization header. */
function bearer(token: string, url = `${APP}/api`): Request {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

const keys = (): ClerkServerOptions => ({
  secretKey: SECRET_KEY,
  publishableKey: PUBLISHABLE_KEY,
  authorizedParties: [APP],
  jwtKey: publicPem,
});

describe("authenticateRequest: valid and invalid tokens", () => {
  it("[SRV-01] a valid session token signs the user in with the session and user ids", async () => {
    const auth = await authenticateRequest(bearer(sign()), keys());
    expect(auth.isSignedIn).toBe(true);
    expect(auth.userId).toBe("user_123");
    expect(auth.sessionId).toBe("sess_123");
    expect(auth.reason).toBeNull();
  });

  it("[SRV-02] the organization id and role come from the v2 organization claim", async () => {
    const token = sign({ o: { id: "org_9", rol: "admin", slg: "acme" } });
    const auth = await authenticateRequest(bearer(token), keys());
    expect(auth.orgId).toBe("org_9");
    expect(auth.orgRole).toBe("org:admin");
  });

  it("[SRV-03] the verified claims are returned", async () => {
    const auth = await authenticateRequest(bearer(sign({ custom: "value" })), keys());
    expect(auth.claims?.["custom"]).toBe("value");
    expect(auth.claims?.["sub"]).toBe("user_123");
  });

  it("[SRV-04] a token in the session cookie is accepted with the client-uat companion cookie", async () => {
    const cookie = `__session=${sign()}; __client_uat=${now()}`;
    const auth = await authenticateRequest(
      new Request(`${APP}/api`, { headers: { cookie } }),
      keys(),
    );
    expect(auth.isSignedIn).toBe(true);
  });

  it("[SRV-04b] a session cookie without __client_uat is not trusted by itself", async () => {
    const request = new Request(`${APP}/api`, { headers: { cookie: `__session=${sign()}` } });
    const auth = await authenticateRequest(request, keys());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.reason).toBe("session-token-but-no-client-uat");
  });

  it("[SRV-05] an expired token is rejected with the token-expired reason and no throw", async () => {
    const token = sign({ iat: now() - 200, nbf: now() - 300, exp: now() - 100 });
    const auth = await authenticateRequest(bearer(token), keys());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.reason).toContain("expired");
    expect(auth.userId).toBeNull();
  });

  it("[SRV-06] a token signed by another key (forged) is rejected: invalid signature", async () => {
    const auth = await authenticateRequest(bearer(sign({}, otherKey)), keys());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.reason).toBe("token-invalid-signature");
    expect(auth.userId).toBeNull();
  });

  it("[SRV-07] a token whose payload was changed after signing is rejected", async () => {
    const valid = sign({});
    const [header, , signature] = valid.split(".");
    const forgedBody = b64u({
      v: 2,
      azp: APP,
      sub: "user_admin",
      sid: "s",
      iss: ISSUER,
      exp: now() + 999,
    });
    const auth = await authenticateRequest(bearer(`${header}.${forgedBody}.${signature}`), keys());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.reason).toBe("token-invalid-signature");
  });

  it("[SRV-08] a token with alg none is rejected", async () => {
    const unsigned = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ v: 2, sub: "u", sid: "s", iss: ISSUER, azp: APP, exp: now() + 60, nbf: now() - 5 })}.`;
    const auth = await authenticateRequest(bearer(unsigned), keys());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.reason).toBe("token-invalid-algorithm");
  });

  it("[SRV-09] a token that is not yet valid (nbf in the future) is rejected", async () => {
    const auth = await authenticateRequest(bearer(sign({ nbf: now() + 3600 })), keys());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.reason).toContain("nbf");
  });

  it("[SRV-10] a token that is not a JWT at all is rejected without throwing", async () => {
    const auth = await authenticateRequest(bearer("not-a-jwt"), keys());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.reason).toBe("token-invalid");
  });

  it("[SRV-11] a request without any token is signed out, without throwing", async () => {
    const auth = await authenticateRequest(new Request(`${APP}/api`), keys());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.userId).toBeNull();
    expect(auth.claims).toBeNull();
    expect(auth.reason).not.toBeNull();
  });

  it("[SRV-12] a token whose azp is not an authorized party is rejected", async () => {
    const token = sign({ azp: "https://evil.example" });
    const auth = await authenticateRequest(bearer(token), keys());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.reason).toBe("token-invalid-authorized-parties");
  });

  it("[SRV-13] authorizedParties: false is the explicit opt-out: the azp claim is not checked", async () => {
    const options: ClerkServerOptions = {
      secretKey: SECRET_KEY,
      publishableKey: PUBLISHABLE_KEY,
      authorizedParties: false,
      jwtKey: publicPem,
    };
    const auth = await authenticateRequest(bearer(sign({ azp: "https://other.example" })), options);
    expect(auth.isSignedIn).toBe(true);
  });

  it("[SRV-14] an authorized party list with several origins accepts each of them", async () => {
    const options = { ...keys(), authorizedParties: [APP, "https://admin.example.com"] };
    const auth = await authenticateRequest(
      bearer(sign({ azp: "https://admin.example.com" })),
      options,
    );
    expect(auth.isSignedIn).toBe(true);
  });

  it("[SRV-15] two requests with two sessions keep their own session ids", async () => {
    const a = await authenticateRequest(bearer(sign({ sid: "sess_a" })), keys());
    const b = await authenticateRequest(bearer(sign({ sid: "sess_b" })), keys());
    expect(a.sessionId).toBe("sess_a");
    expect(b.sessionId).toBe("sess_b");
  });
});

describe("authenticateRequest: getToken and secrets", () => {
  it("[SRV-16] getToken returns the session token of a signed-in request", async () => {
    const token = sign();
    const auth = await authenticateRequest(bearer(token), keys());
    expect(await auth.getToken()).toBe(token);
  });

  it("[SRV-17] getToken returns null for a signed-out request", async () => {
    const auth = await authenticateRequest(new Request(`${APP}/api`), keys());
    expect(await auth.getToken()).toBeNull();
    expect(await auth.getToken({ template: "convex" })).toBeNull();
  });

  it("[SRV-18] nothing about the server auth object carries the secret key", async () => {
    const auth = await authenticateRequest(bearer(sign()), keys());
    expect(JSON.stringify(auth)).not.toContain(SECRET_KEY);
    expect(Object.values(auth).some((value) => value === SECRET_KEY)).toBe(false);
  });

  it("[SRV-19] no secret or token is written to the console while authenticating", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "debug")];
    const token = sign({}, otherKey);
    try {
      await authenticateRequest(bearer(token), keys());
      for (const spy of spies) {
        const text = JSON.stringify(spy.mock.calls);
        expect(text).not.toContain(SECRET_KEY);
        expect(text).not.toContain(token);
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("authenticateRequest: option validation", () => {
  it("[SRV-20] a missing secret key is rejected with a clear message", async () => {
    await expect(authenticateRequest(bearer(sign()), { ...keys(), secretKey: "" })).rejects.toThrow(
      /secretKey is required/,
    );
  });

  it("[SRV-21] a secret key with the wrong prefix is rejected without echoing it", async () => {
    const error = await authenticateRequest(bearer(sign()), {
      ...keys(),
      secretKey: "pk_live_nope",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).toContain("must start with sk_test_ or sk_live_");
    expect(String(error)).not.toContain("pk_live_nope");
  });

  it("[SRV-22] a missing publishable key is rejected", async () => {
    await expect(
      authenticateRequest(bearer(sign()), { ...keys(), publishableKey: "" }),
    ).rejects.toThrow(/publishableKey is required/);
  });

  it("[SRV-23] a publishable key with the wrong prefix is rejected", async () => {
    await expect(
      authenticateRequest(bearer(sign()), { ...keys(), publishableKey: "sk_live_x" }),
    ).rejects.toThrow(/publishableKey must start with pk_test_ or pk_live_/);
  });

  it("[SRV-24] an empty origin in authorizedParties is rejected", async () => {
    await expect(
      authenticateRequest(bearer(sign()), { ...keys(), authorizedParties: [""] }),
    ).rejects.toThrow(/authorizedParties/);
  });

  it("[SRV-25] a jwtKey that is not a PEM public key is rejected", async () => {
    await expect(
      authenticateRequest(bearer(sign()), { ...keys(), jwtKey: "not a key" }),
    ).rejects.toThrow(/jwtKey must be the PEM public key/);
  });

  it("[SRV-26] option errors never include the values that were passed", async () => {
    const bad = { ...keys(), secretKey: "sk_wrong_SECRETVALUE" };
    const error = await authenticateRequest(bearer(sign()), bad).catch((caught: unknown) => caught);
    expect(String(error)).not.toContain("SECRETVALUE");
  });

  it("[SRV-27] a secret key with embedded whitespace is rejected", async () => {
    await expect(
      authenticateRequest(bearer(sign()), { ...keys(), secretKey: "sk_live_has space" }),
    ).rejects.toThrow(/secretKey must start/);
  });
});

describe("requireAuth", () => {
  it("[SRV-28] returns the signed-in auth for a valid token", async () => {
    const auth = await requireAuth(bearer(sign()), keys());
    expect(auth.userId).toBe("user_123");
  });

  it("[SRV-29] a signed-out request without a sign-in URL rejects with a 401 Response", async () => {
    const error = await requireAuth(new Request(`${APP}/api`), keys()).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(401);
  });

  it("[SRV-30] a signed-out request with a sign-in URL rejects with a 302 redirect", async () => {
    const error = await requireAuth(new Request(`${APP}/api`), {
      ...keys(),
      signInUrl: "/sign-in",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(302);
    expect((error as Response).headers.get("location")).toBe("/sign-in");
  });

  it("[SRV-31] an https sign-in URL is accepted", async () => {
    const error = await requireAuth(new Request(`${APP}/api`), {
      ...keys(),
      signInUrl: "https://accounts.example.com/sign-in",
    }).catch((caught: unknown) => caught);
    expect((error as Response).headers.get("location")).toBe(
      "https://accounts.example.com/sign-in",
    );
  });

  it.each([
    ["a javascript: URL", "javascript:alert(1)"],
    ["a protocol-relative URL", "//evil.example/steal"],
    ["a backslash URL", "/\\evil.example"],
    ["a plain http URL", "http://insecure.example/sign-in"],
  ])("[SRV-32] a sign-in URL that is %s is rejected", async (_label, url) => {
    const error = await requireAuth(new Request(`${APP}/api`), {
      ...keys(),
      signInUrl: url,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(Response);
  });

  it("[SRV-33] the redirect is not generated for a signed-in request, even with a sign-in URL", async () => {
    const auth = await requireAuth(bearer(sign()), { ...keys(), signInUrl: "/sign-in" });
    expect(auth.isSignedIn).toBe(true);
  });
});

describe("clerkMiddleware", () => {
  it("[SRV-34] calls next and returns its response", async () => {
    const middleware = clerkMiddleware(keys());
    const response = await middleware({ request: bearer(sign()) }, async () => new Response("ok"));
    expect(await response.text()).toBe("ok");
  });

  it("[SRV-35] makes the authentication outcome available through getAuth", async () => {
    const middleware = clerkMiddleware(keys());
    const event = { request: bearer(sign()) };
    await middleware(event, async () => new Response("ok"));
    expect(getAuth(event)?.userId).toBe("user_123");
  });

  it("[SRV-36] getAuth is undefined for events the middleware never saw", () => {
    expect(getAuth({ request: new Request(APP) })).toBeUndefined();
  });

  it("[SRV-37] the middleware does not block an unauthenticated request by itself", async () => {
    const middleware = clerkMiddleware(keys());
    const event = { request: new Request(`${APP}/public`) };
    const response = await middleware(event, async () => new Response("public"));
    expect(await response.text()).toBe("public");
    expect(getAuth(event)?.isSignedIn).toBe(false);
  });

  it("[SRV-38] options are checked when the middleware is created", () => {
    expect(() => clerkMiddleware({ ...keys(), secretKey: "" })).toThrow(/secretKey is required/);
  });

  it("[SRV-39] an error thrown by next propagates to the caller", async () => {
    const middleware = clerkMiddleware(keys());
    await expect(
      middleware({ request: bearer(sign()) }, async () => {
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");
  });

  it("[SRV-40] 50 interleaved requests each keep their own outcome", async () => {
    const middleware = clerkMiddleware(keys());
    const events = Array.from({ length: 50 }, (_, index) => ({
      index,
      event: {
        request: index % 2 === 0 ? bearer(sign({ sub: `user_${index}` })) : new Request(APP),
      },
    }));
    await Promise.all(events.map(({ event }) => middleware(event, async () => new Response("ok"))));
    for (const { index, event } of events) {
      const auth = getAuth(event);
      expect(auth?.isSignedIn).toBe(index % 2 === 0);
      if (index % 2 === 0) expect(auth?.userId).toBe(`user_${index}`);
    }
  });
});

describe("authenticateRequest: the same request authenticated twice", () => {
  it("[SRV-41] repeating a request gives the same answer", async () => {
    const request = bearer(sign());
    const first = await authenticateRequest(request, keys());
    const second = await authenticateRequest(request.clone(), keys());
    expect(second.userId).toBe(first.userId);
  });
});
