import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateRequest } from "../src/server/authenticate";
import { clerkMiddleware, getAuth } from "../src/server/middleware";
import { createRouteMatcher } from "../src/server/route-matcher";

/*
 * A resolved development handshake: a request with `?__clerk_handshake=...` on a development instance comes back from
 * `@clerk/backend` as `signed-in` or `signed-out` (not `handshake`), with the session cookies and a `Location` that is the
 * same URL without the handshake parameters. The middleware answers it with that redirect before any handler runs, as
 * `@clerk/nextjs` does; otherwise the handlers run on a URL that still carries a stale token, and a sign-in redirect that
 * names that URL as `redirect_url` loops.
 */

interface Outcome {
  status: "signed-in" | "signed-out" | "handshake";
  headers: Headers;
  signedIn: boolean;
}

const backend = vi.hoisted(() => ({
  outcome: undefined as undefined | Outcome,
  calls: 0,
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    authenticateRequest: async () => {
      backend.calls += 1;
      const outcome = backend.outcome;
      if (outcome === undefined) throw new Error("no outcome configured");
      return {
        status: outcome.status,
        headers: outcome.headers,
        isSignedIn: outcome.signedIn,
        reason: null,
        token: outcome.signedIn ? "token-value-never-sent" : null,
        toAuth: () =>
          outcome.signedIn
            ? {
                userId: "user_1",
                sessionId: "sess_1",
                orgId: null,
                orgRole: null,
                sessionClaims: { sub: "user_1" },
                getToken: async () => "token-value-never-sent",
              }
            : { userId: null },
      };
    },
  }),
}));

const FRONTEND = "bright-otter-42.clerk.accounts.dev$";
const KEY = `pk_test_${Buffer.from(FRONTEND).toString("base64")}`;
const APP = "http://dashboard.localhost:3000";

const options = (extra: Record<string, unknown> = {}) => ({
  secretKey: "sk_test_secret_value_do_not_log",
  publishableKey: KEY,
  authorizedParties: [APP],
  ...extra,
});

function outcome(
  status: Outcome["status"],
  signedIn: boolean,
  location: string | null,
  cookies: string[] = ["__session=fresh; Path=/; HttpOnly", "__client_uat=1700000000; Path=/"],
): void {
  const headers = new Headers();
  if (location !== null) headers.set("location", location);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  backend.outcome = { status, headers, signedIn };
}

const STALE = `${APP}/episodes?page=2&__clerk_handshake=stale&__clerk_help=1&__clerk_db_jwt=dev&__clerk_handshake_nonce=n`;
const CLEAN = `${APP}/episodes?page=2`;

function document(url: string): Request {
  return new Request(url, {
    headers: { accept: "text/html", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" },
  });
}

async function run(
  url: string,
  extra: Record<string, unknown> = {},
  middlewareOptions: Record<string, unknown> = {},
) {
  let reached = 0;
  const event = { request: document(url) };
  const middleware = clerkMiddleware({ ...options(extra), ...middlewareOptions });
  const response = await middleware(event, async () => {
    reached += 1;
    return new Response("page");
  });
  return { response, reached, event };
}

beforeEach(() => {
  backend.outcome = undefined;
  backend.calls = 0;
});

describe("a resolved development handshake", () => {
  it("[DHS-1] a signed-in outcome with a location is a 307 to it, with the cookies and no-store, before any handler", async () => {
    outcome("signed-in", true, CLEAN);
    const { response, reached } = await run(STALE);
    expect(reached).toBe(0);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(CLEAN);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([
      "__session=fresh; Path=/; HttpOnly",
      "__client_uat=1700000000; Path=/",
    ]);
  });

  it("[DHS-2] a signed-out outcome with a location is followed too: the stale token is not replayed", async () => {
    outcome("signed-out", false, CLEAN);
    const { response, reached } = await run(STALE);
    expect(reached).toBe(0);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(CLEAN);
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it("[DHS-3] with protect, the request is redirected to where Clerk said, not to sign-in with the stale URL as redirect_url", async () => {
    outcome("signed-out", false, CLEAN);
    const { response, reached } = await run(
      STALE,
      {},
      {
        protect: { matcher: createRouteMatcher(["/episodes(.*)"]), signInUrl: "/sign-in" },
      },
    );
    expect(reached).toBe(0);
    expect(response.headers.get("location")).toBe(CLEAN);
    expect(response.headers.get("location")).not.toContain("sign-in");
  });

  it("[DHS-4] the same request without the handshake parameters runs the handlers, and protect sends it to sign-in once", async () => {
    outcome("signed-out", false, null, []);
    const open = await run(CLEAN);
    expect(open.reached).toBe(1);
    const guarded = await run(
      CLEAN,
      {},
      {
        protect: { matcher: createRouteMatcher(["/episodes(.*)"]), signInUrl: "/sign-in" },
      },
    );
    expect(guarded.reached).toBe(0);
    expect(guarded.response.headers.get("location")).toBe(
      "/sign-in?redirect_url=%2Fepisodes%3Fpage%3D2",
    );
  });

  it("[DHS-5] a location on another origin is refused: no redirect, no cookies, signed out with the reason", async () => {
    for (const location of [
      "https://evil.example/steal",
      "//evil.example/x",
      "http://dashboard.localhost:3001/episodes",
      "https://dashboard.localhost:3000/episodes",
      "javascript:alert(1)",
    ]) {
      outcome("signed-in", true, location);
      const { response, reached, event } = await run(STALE);
      expect(reached, location).toBe(1);
      expect(response.status, location).toBe(200);
      expect(response.headers.get("location"), location).toBeNull();
      expect(response.headers.getSetCookie(), location).toEqual([]);
      const auth = getAuth(event);
      expect(auth?.isSignedIn, location).toBe(false);
      expect(auth?.reason, location).toBe("handshake-refused");
    }
  });

  it("[DHS-6] a relative location resolves against the request and is followed as written", async () => {
    outcome("signed-in", true, "/episodes?page=2");
    const { response } = await run(STALE);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/episodes?page=2");
  });

  it("[DHS-7] an origin listed in authorizedParties is a place Clerk may send the browser to", async () => {
    outcome("signed-in", true, "http://localhost:3000/sign-in-done");
    const refused = await run(STALE);
    expect(refused.response.status).toBe(200);
    outcome("signed-in", true, "http://localhost:3000/sign-in-done");
    const listed = await run(STALE, { authorizedParties: [APP, "http://localhost:3000"] });
    expect(listed.response.status).toBe(307);
    expect(listed.response.headers.get("location")).toBe("http://localhost:3000/sign-in-done");
  });

  it("[DHS-8] an outcome without a location is not a redirect: the handlers run and the cookies are added", async () => {
    outcome("signed-in", true, null);
    const { response, reached } = await run(CLEAN);
    expect(reached).toBe(1);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it("[DHS-9] authenticateRequest reports the location with the outcome, for a route that calls it itself, and never the token", async () => {
    outcome("signed-in", true, CLEAN);
    const auth = await authenticateRequest(document(STALE), options());
    expect(auth.status).toBe("signed-in");
    expect(auth.headers.get("location")).toBe(CLEAN);
    expect([...auth.headers.keys()]).not.toContain("x-clerk-auth-token");
  });
});
