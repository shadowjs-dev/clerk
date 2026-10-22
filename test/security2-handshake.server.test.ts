import fc from "fast-check";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { authenticateRequest, type ServerAuth } from "../src/server/authenticate";
import { clerkMiddleware } from "../src/server/middleware";
import { requireAuth } from "../src/server/require-auth";
import { createRouteMatcher } from "../src/server/route-matcher";
import {
  APP,
  DEV_PUBLISHABLE_KEY,
  DEV_SECRET_KEY,
  hmacToken,
  ISSUER,
  LIVE_PUBLISHABLE_KEY,
  LIVE_SECRET_KEY,
  makeKeys,
  nowSeconds,
  page,
  sessionToken,
  signParts,
  type TestKeys,
} from "./support/sec2-server";

/**
 * PASS 2, scope A (Clerk), server handshake. `@clerk/backend` decides the handshake; the wrapper decides what
 * reaches the browser. These tests run the real backend against tokens signed here (`jwtKey` is the local
 * public key, so nothing reaches the network) and look at the redirect, the cookies and the headers.
 */

let keys: TestKeys;
let otherKeys: TestKeys;

beforeAll(() => {
  keys = makeKeys();
  otherKeys = makeKeys();
});

const live = () => ({
  secretKey: LIVE_SECRET_KEY,
  publishableKey: LIVE_PUBLISHABLE_KEY,
  authorizedParties: [APP],
  jwtKey: keys.publicPem,
});

const dev = () => ({
  secretKey: DEV_SECRET_KEY,
  publishableKey: DEV_PUBLISHABLE_KEY,
  authorizedParties: [APP],
  jwtKey: keys.publicPem,
});

const DEV_FRONTEND = "https://bright-otter-42.clerk.accounts.dev";

/** The cookies of a browser whose 60-second session token has expired. */
function expiredSession(): string[] {
  const token = sessionToken(keys, { iat: nowSeconds() - 120, exp: nowSeconds() - 60 });
  return [`__session=${token}`, "__client_uat=1700000000"];
}

/** The backend reports a failed handshake on the console; the test reads and clears it. */
function takeConsoleErrors(): string[] {
  const seen = vi.mocked(console.error).mock.calls.map((args) => args.map(String).join(" "));
  vi.mocked(console.error).mockClear();
  return seen;
}

describe("SEC2-CLERK-0x the handshake redirect", () => {
  it.each([
    ["a double slash after the host", "//evil.example/x"],
    ["an encoded double slash", "/%2F%2Fevil.example"],
    ["a backslash path", "/\\evil.example"],
    ["a javascript: query", "/?redirect_url=javascript:alert(1)"],
    ["a foreign redirect_url query", "/dashboard?redirect_url=https://evil.example&x=1#frag"],
    ["a @ in the path", "/@evil.example/x"],
  ])(
    "[SEC2-CLERK-01] %s: the redirect stays on the frontend API host and carries one redirect_url",
    async (_name, path) => {
      const auth = await authenticateRequest(page(path, expiredSession()), live());
      expect(auth.status).toBe("handshake");
      const location = new URL(auth.headers.get("location") ?? "");
      expect(location.origin).toBe(ISSUER);
      expect(location.pathname).toBe("/v1/client/handshake");
      const back = location.searchParams.getAll("redirect_url");
      expect(back).toHaveLength(1);
      expect(new URL(back[0] ?? "").origin).toBe(APP);
    },
  );

  it("[SEC2-CLERK-02] a development instance does not follow __clerk_redirect_url: no redirect leaves the frontend API, and the dev-browser token stays with it", async () => {
    // Without the fix @clerk/backend answers `?__clerk_redirect_url=` with a redirect to that URL and appends the
    // dev-browser token (`__clerk_db_jwt`) to it: an open redirect that hands the token to the attacker's host.
    const secret = "DEVBROWSERSECRET";
    const middleware = clerkMiddleware(dev());
    const request = page("/dashboard?__clerk_redirect_url=https://evil.example/steal", [
      `__clerk_db_jwt=${secret}`,
    ]);
    const response = await middleware({ request }, async () => new Response("page"));
    const location = response.headers.get("location");
    if (location !== null) expect(new URL(location).origin).toBe(DEV_FRONTEND);
    expect(JSON.stringify([...response.headers])).not.toContain("evil.example");
    expect(takeConsoleErrors()).toEqual([]);
  });

  it("[SEC2-CLERK-02a] the dev-browser sync still works: a request with a dev-browser token in the URL is sent to the frontend API", async () => {
    const auth = await authenticateRequest(page("/dashboard?__clerk_db_jwt=DBTOKEN123"), dev());
    expect(auth.status).toBe("handshake");
    const location = new URL(auth.headers.get("location") ?? "");
    expect(location.origin).toBe(DEV_FRONTEND);
    // The token goes to the frontend API only; no other header carries it.
    const others = [...auth.headers].filter(([name]) => name !== "location");
    expect(JSON.stringify(others)).not.toContain("DBTOKEN123");
  });

  it("[SEC2-CLERK-03] a forged forwarded host cannot make the handshake return to another origin", async () => {
    // `@clerk/backend` builds redirect_url from X-Forwarded-Host. With authorizedParties set, an origin that is not
    // listed is refused instead of being sent to Clerk.
    const poisoned = page("/dashboard", expiredSession(), {
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    });
    const auth = await authenticateRequest(poisoned, live());
    expect(auth.status).toBe("signed-out");
    expect(auth.isSignedIn).toBe(false);
    expect(auth.headers.get("location")).toBeNull();
    expect(auth.reason).toBe("handshake-refused");
  });

  it("[SEC2-CLERK-03a] a forwarded host that is a listed origin still hands the browser to Clerk", async () => {
    const request = page("/dashboard", expiredSession(), {
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
    });
    const auth = await authenticateRequest(request, live());
    expect(auth.status).toBe("handshake");
    const back = new URL(auth.headers.get("location") ?? "").searchParams.get("redirect_url");
    expect(new URL(back ?? "").origin).toBe(APP);
  });

  it("[SEC2-CLERK-03b] authorizedParties: false is the documented opt-out of the origin check", async () => {
    const request = page("/dashboard", expiredSession(), {
      "x-forwarded-host": "other.example",
      "x-forwarded-proto": "https",
    });
    const auth = await authenticateRequest(request, { ...live(), authorizedParties: false });
    expect(auth.status).toBe("handshake");
    expect(new URL(auth.headers.get("location") ?? "").origin).toBe(ISSUER);
  });
});

describe("SEC2-CLERK-0x handshake tokens and cookies", () => {
  const sessionNow = (): string => sessionToken(keys);

  /** A handshake token signed with `signer`, carrying `directives` as the cookies to set. */
  function handshakeToken(
    directives: readonly string[],
    signer: TestKeys = keys,
    header: Record<string, unknown> = {},
  ): string {
    return signParts(
      { alg: "RS256", typ: "JWT", kid: "ins_test", ...header },
      { iss: ISSUER, iat: nowSeconds(), handshake: directives },
      signer.privateKey,
    );
  }

  it("[SEC2-CLERK-04] a handshake token that Clerk did not sign sets no cookie and signs nobody in", async () => {
    const directives = [
      `__session=${sessionNow()}; Path=/; Domain=evil.example`,
      "__client_uat=1; Path=/",
    ];
    const forged: string[] = [
      handshakeToken(directives, otherKeys),
      hmacToken(keys.publicPem, { iss: ISSUER, handshake: directives }),
      `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${Buffer.from(
        JSON.stringify({ iss: ISSUER, handshake: directives }),
      ).toString("base64url")}.`,
    ];
    const tampered = handshakeToken(directives).split(".");
    tampered[1] = Buffer.from(
      JSON.stringify({
        iss: ISSUER,
        handshake: [`__session=${sessionNow()}; Domain=evil.example`],
      }),
    ).toString("base64url");
    forged.push(tampered.join("."));
    for (const token of forged) {
      const auth = await authenticateRequest(page(`/dashboard?__clerk_handshake=${token}`), live());
      expect(auth.status).toBe("signed-out");
      expect(auth.isSignedIn).toBe(false);
      expect(auth.headers.getSetCookie()).toEqual([]);
      const viaCookie = await authenticateRequest(
        page("/dashboard", [`__clerk_handshake=${token}`]),
        live(),
      );
      expect(viaCookie.isSignedIn).toBe(false);
      expect(viaCookie.headers.getSetCookie()).toEqual([]);
    }
    // The backend writes why the handshake failed to the console (one line per failed token).
    expect(takeConsoleErrors().length).toBeGreaterThan(0);
  });

  it("[SEC2-CLERK-05] a replayed handshake token whose session token has expired is refused and sets no cookie", async () => {
    const stale = sessionToken(keys, { iat: nowSeconds() - 300, exp: nowSeconds() - 240 });
    const token = handshakeToken([`__session=${stale}; Path=/`, "__client_uat=1; Path=/"]);
    const auth = await authenticateRequest(page(`/dashboard?__clerk_handshake=${token}`), live());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.headers.getSetCookie()).toEqual([]);
    expect(takeConsoleErrors().length).toBeGreaterThan(0);
  });

  it("[SEC2-CLERK-05a] the cookies of a valid handshake reach the browser exactly as Clerk wrote them", async () => {
    const directives = [
      `__session=${sessionNow()}; Path=/; Secure; SameSite=Lax; Max-Age=3600`,
      "__client_uat=1700000001; Path=/; Secure; SameSite=Lax",
      "__refresh_x=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
    ];
    const middleware = clerkMiddleware(live());
    const request = page(`/dashboard?__clerk_handshake=${handshakeToken(directives)}`);
    const response = await middleware({ request }, async () => new Response("page"));
    expect(response.status).toBe(200);
    // No attribute is added, dropped or rewritten by the wrapper.
    expect(response.headers.getSetCookie()).toEqual(directives);
  });

  it("[SEC2-CLERK-05b] a header-injection attempt in a directive cannot add a header", async () => {
    // `Headers` refuses CR and LF in a value; the wrapper must not turn that into a thrown 500 or a second header.
    const poisoned = new Headers();
    expect(() => poisoned.append("set-cookie", "a=b\r\nSet-Cookie: evil=1")).toThrow(TypeError);
    const directives = [`__session=${sessionNow()}; Path=/`];
    const auth = await authenticateRequest(
      page(`/dashboard?__clerk_handshake=${handshakeToken(directives)}`),
      live(),
    );
    expect(auth.headers.getSetCookie()).toEqual(directives);
  });

  it("[SEC2-CLERK-06] __client_uat is a hint: whatever its value, it never signs a request in without a valid session token", async () => {
    const forgedSession = sessionToken(otherKeys);
    const uat = fc.oneof(
      fc.constantFrom("0", "1", "1700000000", "9999999999", "-1", "NaN", "1e9", "0x10", " 1", ""),
      fc.integer({ min: -5, max: 4_000_000_000 }).map(String),
      fc.string({ maxLength: 20 }).map((text) => text.replace(/[;,=\s]/g, "x")),
    );
    const outcomes: ServerAuth[] = [];
    await fc.assert(
      fc.asyncProperty(uat, async (value) => {
        // `__client_uat` alone, and next to a session token signed by another key.
        for (const cookies of [
          [`__client_uat=${value}`],
          [`__client_uat=${value}`, `__session=${forgedSession}`],
        ]) {
          const auth = await authenticateRequest(page("/dashboard", cookies), live());
          outcomes.push(auth);
          expect(auth.isSignedIn).toBe(false);
          expect(auth.userId).toBeNull();
        }
      }),
      { seed: 20261010, numRuns: 60 },
    );
    expect(outcomes.length).toBe(120);
    takeConsoleErrors();
  });

  it("[SEC2-CLERK-07] the dev-browser token is never copied into a response header except the redirect to the frontend API", async () => {
    const secret = "DEVBROWSERCOOKIE789";
    const cases = [
      page("/dashboard", [`__clerk_db_jwt=${secret}`]),
      page(`/dashboard?__clerk_db_jwt=${secret}`),
      page(`/dashboard?__clerk_db_jwt=${secret}&__clerk_redirect_url=https://evil.example/`),
    ];
    for (const request of cases) {
      const middleware = clerkMiddleware(dev());
      const response = await middleware({ request }, async () => new Response("page"));
      const others = [...response.headers].filter(([name]) => name !== "location");
      expect(JSON.stringify(others)).not.toContain(secret);
      const location = response.headers.get("location");
      if (location !== null) expect(new URL(location).origin).toBe(DEV_FRONTEND);
    }
    takeConsoleErrors();
  });
});

describe("SEC2-CLERK-0x what Clerk's status headers reveal", () => {
  it("[SEC2-CLERK-08] the free-text auth message (attacker-chosen claim values, the expected origins) is not sent to the browser", async () => {
    const hostile = sessionToken(keys, { azp: "https://evil.example" });
    const middleware = clerkMiddleware(live());
    const response = await middleware(
      { request: new Request(`${APP}/api`, { headers: { authorization: `Bearer ${hostile}` } }) },
      async () => new Response("ok"),
    );
    expect(response.headers.get("x-clerk-auth-message")).toBeNull();
    expect(JSON.stringify([...response.headers])).not.toContain("evil.example");
    // The reason code stays: it is a fixed vocabulary.
    expect(response.headers.get("x-clerk-auth-reason")).toBe("token-invalid-authorized-parties");
  });
});

describe("SEC2-CLERK-0x the sign-in redirect of protect and requireAuth", () => {
  const protectedMiddleware = (signInUrl = "/sign-in") =>
    clerkMiddleware({
      ...live(),
      protect: { matcher: createRouteMatcher(["/(.*)"]), signInUrl },
    });

  it.each([
    ["a double slash path", `${APP}//evil.example/x`],
    ["a backslash path", `${APP}/\\evil.example/x`],
    ["a triple slash path", `${APP}///evil.example`],
    ["an encoded double slash path", `${APP}/%2F%2Fevil.example/x`],
  ])(
    "[SEC2-CLERK-09] %s: redirect_url is a same-app path, never a protocol-relative URL",
    async (_name, url) => {
      const response = await protectedMiddleware()(
        { request: new Request(url, { headers: { accept: "application/json" } }) },
        async () => new Response("never"),
      );
      expect(response.status).toBe(307);
      const target = new URL(response.headers.get("location") ?? "", APP);
      expect(target.origin).toBe(APP);
      const back = target.searchParams.get("redirect_url") ?? "";
      expect(back.startsWith("/")).toBe(true);
      expect(back.startsWith("//")).toBe(false);
      expect(back.startsWith("/\\")).toBe(false);
      // The browser resolves it against the app, whatever the sign-in page does with it.
      expect(new URL(back, APP).origin).toBe(APP);
    },
  );

  it("[SEC2-CLERK-10] a sign-in URL that already has a query keeps it, and redirect_url is added once", async () => {
    const response = await protectedMiddleware("/sign-in?lang=ar#top")(
      {
        request: new Request(`${APP}/dashboard?tab=1`, { headers: { accept: "application/json" } }),
      },
      async () => new Response("never"),
    );
    const target = new URL(response.headers.get("location") ?? "", APP);
    expect(target.pathname).toBe("/sign-in");
    expect(target.searchParams.get("lang")).toBe("ar");
    expect(target.searchParams.getAll("redirect_url")).toEqual(["/dashboard?tab=1"]);
    expect(target.hash).toBe("#top");
  });

  it.each([
    ["a tab hides the second slash from the checks", "/\t/evil.example"],
    ["a newline", "/\n/evil.example"],
    ["a backslash", "/\\evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a scheme", "https://evil.example/sign-in"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a control character", "/sign-in\u0000"],
  ])("[SEC2-CLERK-11] protect.signInUrl refuses %s", (_name, signInUrl) => {
    expect(() => protectedMiddleware(signInUrl)).toThrow(TypeError);
  });

  it("[SEC2-CLERK-12] requireAuth rejects with a response no cache may store, and refuses the same sign-in URLs", async () => {
    const none = new Request(`${APP}/api`);
    const redirect = await requireAuth(none, { ...live(), signInUrl: "/sign-in" }).catch(
      (error: unknown) => error,
    );
    expect(redirect).toBeInstanceOf(Response);
    if (!(redirect instanceof Response)) return;
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("cache-control")).toBe("no-store");
    const denied = await requireAuth(none, live()).catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(Response);
    if (!(denied instanceof Response)) return;
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    for (const signInUrl of [
      "/\t/evil.example",
      "//evil.example",
      "/\\x",
      "javascript:alert(1)",
      "http://insecure.example/",
    ]) {
      await expect(requireAuth(none, { ...live(), signInUrl })).rejects.toThrow(TypeError);
    }
  });

  it("[SEC2-CLERK-13] protect also checks the URL the framework moved the event to (a rewrite), not only the original request", async () => {
    // Dusk's config rewrites change `event.url` and leave `event.request` alone. A rule written for the target
    // path must hold for a request that was rewritten to it.
    const middleware = clerkMiddleware({
      ...live(),
      protect: { matcher: createRouteMatcher(["/dashboard(.*)"]), signInUrl: "/sign-in" },
    });
    let ran = false;
    const response = await middleware(
      {
        request: new Request(`${APP}/app`, { headers: { accept: "application/json" } }),
        url: new URL(`${APP}/dashboard`),
      },
      async () => {
        ran = true;
        return new Response("page");
      },
    );
    expect(ran).toBe(false);
    expect(response.status).toBe(307);
  });
});

describe("SEC2-CLERK-0x pending sessions", () => {
  it("[SEC2-CLERK-14] a pending session (the user has not finished the sign-in tasks) is signed out, with no user", async () => {
    // @clerk/backend reports isSignedIn for a pending token and returns a signed-out auth object. The wrapper must
    // not combine them into `isSignedIn: true` with `userId: null`: requireAuth and protect would let it through.
    const pending = sessionToken(keys, { sts: "pending" });
    const request = new Request(`${APP}/api`, { headers: { authorization: `Bearer ${pending}` } });
    const auth = await authenticateRequest(request, live());
    expect(auth.isSignedIn).toBe(false);
    expect(auth.status).toBe("signed-out");
    expect(auth.userId).toBeNull();
    expect(auth.reason).toBe("session-pending");
    await expect(requireAuth(request, { ...live(), signInUrl: "/sign-in" })).rejects.toBeInstanceOf(
      Response,
    );
    const middleware = clerkMiddleware({
      ...live(),
      protect: { matcher: createRouteMatcher(["/api(.*)"]) },
    });
    const response = await middleware({ request }, async () => new Response("secret"));
    expect(response.status).toBe(401);
  });

  it("[SEC2-CLERK-14a] an active session is still signed in", async () => {
    const active = sessionToken(keys, { sts: "active" });
    const auth = await authenticateRequest(
      new Request(`${APP}/api`, { headers: { authorization: `Bearer ${active}` } }),
      live(),
    );
    expect(auth.isSignedIn).toBe(true);
    expect(auth.userId).toBe("user_123");
  });
});
