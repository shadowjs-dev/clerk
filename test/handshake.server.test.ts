import { createPrivateKey, createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { authenticateRequest } from "../src/server/authenticate";
import { answerHeaders, handshakeResponse, withAnswerHeaders } from "../src/server/handshake";
import { clerkMiddleware, getAuth } from "../src/server/middleware";
import { createRouteMatcher } from "../src/server/route-matcher";

/**
 * The handshake of `@clerk/backend` (an expired 60-second session token refreshed by a redirect through
 * Clerk), run for real against tokens signed here. The public key is `jwtKey`, so verification is local.
 * Keys are `pk_live_` shaped: the development-browser handshake is a separate flow (not run here).
 */

const FRONTEND_API = "clerk.example.com$";
const PUBLISHABLE_KEY = `pk_live_${Buffer.from(FRONTEND_API).toString("base64")}`;
const SECRET_KEY = "sk_live_test_secret_value_do_not_log";
const APP = "https://app.example.com";
const ISSUER = "https://clerk.example.com";

let signingKey: KeyObject;
let publicPem: string;

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  signingKey = createPrivateKey(pair.privateKey);
  publicPem = pair.publicKey;
});

const now = (): number => Math.floor(Date.now() / 1000);

function b64u(value: string | object): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(text).toString("base64url");
}

/** A JWT signed with the instance key; `claims` replace the defaults. */
function sign(claims: Record<string, unknown>): string {
  const header = { alg: "RS256", typ: "JWT", kid: "ins_test" };
  const data = `${b64u(header)}.${b64u(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  return `${data}.${signer.sign(signingKey).toString("base64url")}`;
}

/** A current session token for `APP`, or an expired one with `expired: true`. */
function sessionToken(expired = false): string {
  return sign({
    v: 2,
    azp: APP,
    sub: "user_123",
    sid: "sess_123",
    iss: ISSUER,
    nbf: now() - 10,
    iat: expired ? now() - 120 : now(),
    exp: expired ? now() - 60 : now() + 60,
  });
}

const options = () => ({
  secretKey: SECRET_KEY,
  publishableKey: PUBLISHABLE_KEY,
  authorizedParties: [APP],
  jwtKey: publicPem,
});

/** A document request (what a browser sends for a page) with the given cookies. */
function page(path: string, cookies: string[] = []): Request {
  const headers: Record<string, string> = {
    accept: "text/html",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
  };
  if (cookies.length > 0) headers["cookie"] = cookies.join("; ");
  return new Request(`${APP}${path}`, { headers });
}

describe("the handshake (an expired session cookie refreshed through Clerk)", () => {
  it("[HSH-01] an expired session token with the client-uat companion is a handshake, not a plain sign-out", async () => {
    const auth = await authenticateRequest(
      page("/dashboard", [`__session=${sessionToken(true)}`, "__client_uat=1700000000"]),
      options(),
    );
    expect(auth.status).toBe("handshake");
    expect(auth.isSignedIn).toBe(false);
    // The library's reason names the refresh it asks for (no refresh cookie is present in this request).
    expect(auth.reason).toBe("session-token-expired-refresh-non-eligible-no-refresh-cookie");
    expect(auth.headers.get("location")).toContain(`${ISSUER}/v1/client/handshake`);
  });

  it("[HSH-02] a request with no session at all is signed out, with no handshake", async () => {
    const auth = await authenticateRequest(page("/dashboard"), options());
    expect(auth.status).toBe("signed-out");
    expect(auth.headers.get("location")).toBeNull();
  });

  it("[HSH-03] a current session token is signed in, and its status headers never carry the token", async () => {
    const token = sessionToken();
    const auth = await authenticateRequest(
      page("/dashboard", [`__session=${token}`, "__client_uat=1700000000"]),
      options(),
    );
    expect(auth.status).toBe("signed-in");
    expect(auth.userId).toBe("user_123");
    expect(auth.headers.get("x-clerk-auth-token")).toBeNull();
    expect(auth.headers.get("x-clerk-auth-signature")).toBeNull();
    expect([...auth.headers.values()].join(" ")).not.toContain(token);
  });

  it("[HSH-04] the middleware answers a handshake with 307 to Clerk and never runs the route", async () => {
    let ran = false;
    const middleware = clerkMiddleware(options());
    const response = await middleware(
      {
        request: page("/dashboard", [`__session=${sessionToken(true)}`, "__client_uat=1700000000"]),
      },
      async () => {
        ran = true;
        return new Response("page");
      },
    );
    expect(ran).toBe(false);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(`${ISSUER}/v1/client/handshake`);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("[HSH-05] the return leg of the handshake sets the refreshed session cookie on the route's response", async () => {
    const handshake = sign({
      iss: ISSUER,
      iat: now(),
      exp: now() + 60,
      nbf: now() - 10,
      handshake: [
        `__session=${sessionToken()}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        "__client_uat=1700000001; Path=/; Secure; SameSite=Lax",
      ],
    });
    const request = new Request(`${APP}/dashboard?__clerk_handshake=${handshake}`, {
      headers: { accept: "text/html", "sec-fetch-dest": "document" },
    });
    const middleware = clerkMiddleware(options());
    const response = await middleware(
      { request },
      async () => new Response("page", { status: 200 }),
    );
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith("__session="))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith("__client_uat="))).toBe(true);
  });

  it("[HSH-06] the outcome is stored for the handlers, with the same status", async () => {
    const middleware = clerkMiddleware(options());
    const event = { request: page("/dashboard") };
    await middleware(event, async () => new Response("page"));
    expect(getAuth(event)?.status).toBe("signed-out");
  });
});

describe("answer headers and the protected routes", () => {
  it("[HSH-07] answerHeaders keeps the redirect, the cookies and the x-clerk status, and drops the token", () => {
    const source = new Headers();
    source.set("location", `${ISSUER}/v1/client/handshake`);
    source.set("x-clerk-auth-status", "handshake");
    source.set("x-clerk-auth-reason", "session-token-expired");
    source.set("x-clerk-auth-token", "secret-token-value");
    source.set("x-clerk-auth-signature", "secret-signature");
    source.append("set-cookie", "__session=a; Path=/");
    source.append("set-cookie", "__client_uat=1; Path=/");
    const answer = answerHeaders(source);
    expect(answer.get("location")).toBe(`${ISSUER}/v1/client/handshake`);
    expect(answer.get("x-clerk-auth-status")).toBe("handshake");
    expect(answer.get("x-clerk-auth-token")).toBeNull();
    expect(answer.get("x-clerk-auth-signature")).toBeNull();
    expect(answer.getSetCookie()).toEqual(["__session=a; Path=/", "__client_uat=1; Path=/"]);
  });

  it("[HSH-08] handshakeResponse is undefined without a location, so the request is treated as signed out", () => {
    expect(handshakeResponse({ status: "handshake", headers: new Headers() })).toBeUndefined();
    expect(handshakeResponse({ status: "signed-out", headers: new Headers() })).toBeUndefined();
  });

  it("[HSH-09] withAnswerHeaders adds the x-clerk status and the cookies to a response", () => {
    const answer = new Headers({ "x-clerk-auth-status": "signed-in" });
    answer.append("set-cookie", "__session=b; Path=/");
    const out = withAnswerHeaders(new Response("ok"), answer);
    expect(out.headers.get("x-clerk-auth-status")).toBe("signed-in");
    expect(out.headers.getSetCookie()).toEqual(["__session=b; Path=/"]);
  });

  it("[HSH-10] protect: a signed-out request to a protected route is sent to sign-in with redirect_url, before the route runs", async () => {
    let ran = false;
    const middleware = clerkMiddleware({
      ...options(),
      protect: { matcher: createRouteMatcher(["/dashboard(.*)"]), signInUrl: "/sign-in" },
    });
    const response = await middleware({ request: page("/dashboard/files?tab=1") }, async () => {
      ran = true;
      return new Response("page");
    });
    expect(ran).toBe(false);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "/sign-in?redirect_url=%2Fdashboard%2Ffiles%3Ftab%3D1",
    );
  });

  it("[HSH-11] protect: a signed-in request and an unmatched route both run the route", async () => {
    const middleware = clerkMiddleware({
      ...options(),
      protect: { matcher: createRouteMatcher(["/dashboard(.*)"]) },
    });
    const signedIn = await middleware(
      {
        request: page("/dashboard", [`__session=${sessionToken()}`, "__client_uat=1700000000"]),
      },
      async () => new Response("inside"),
    );
    expect(await signedIn.text()).toBe("inside");
    const public_ = await middleware({ request: page("/") }, async () => new Response("public"));
    expect(await public_.text()).toBe("public");
  });

  it("[HSH-12] protect without a sign-in URL answers 401; a sign-in URL must be a same-app path", async () => {
    const middleware = clerkMiddleware({
      ...options(),
      protect: { matcher: createRouteMatcher(["/dashboard(.*)"]) },
    });
    const response = await middleware(
      { request: page("/dashboard") },
      async () => new Response("x"),
    );
    expect(response.status).toBe(401);
    expect(() =>
      clerkMiddleware({
        ...options(),
        protect: { matcher: createRouteMatcher(["/x"]), signInUrl: "https://evil.example/sign-in" },
      }),
    ).toThrow(/same-app path/);
  });
});
