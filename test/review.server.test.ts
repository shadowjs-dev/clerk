import { beforeAll, describe, expect, it, vi } from "vitest";
import { clerkMiddleware } from "../src/server/middleware";
import { checkServerOptions } from "../src/server/options";
import { createRouteMatcher } from "../src/server/route-matcher";
import {
  APP,
  DEV_SECRET_KEY,
  LIVE_PUBLISHABLE_KEY,
  LIVE_SECRET_KEY,
  makeKeys,
  publishableKeyFor,
  type TestKeys,
} from "./support/sec2-server";

/**
 * Review round: the sign-in redirect of `protect`. Real `@clerk/backend`, local `jwtKey`, no network.
 */

let keys: TestKeys;

beforeAll(() => {
  keys = makeKeys();
});

const protectedBy = (patterns: string[], signInUrl: string) =>
  clerkMiddleware({
    secretKey: LIVE_SECRET_KEY,
    publishableKey: LIVE_PUBLISHABLE_KEY,
    authorizedParties: [APP],
    jwtKey: keys.publicPem,
    protect: { matcher: createRouteMatcher(patterns), signInUrl },
  });

const json = (path: string): Request =>
  new Request(`${APP}${path}`, { headers: { accept: "application/json" } });

describe("clerkMiddleware protect: the sign-in page itself", () => {
  it("[CLERK-REV-1] a matcher that covers the sign-in page does not redirect it to itself", async () => {
    const middleware = protectedBy(["/(.*)"], "/sign-in");
    // The first hop: a protected page goes to the sign-in page.
    const first = await middleware({ request: json("/dashboard") }, async () => new Response("no"));
    expect(first.status).toBe(307);
    const location = first.headers.get("location") ?? "";
    expect(location).toBe("/sign-in?redirect_url=%2Fdashboard");
    // The second hop: the browser asks for the sign-in page, which the matcher also covers. Redirecting it to
    // itself would nest redirect_url one level deeper on every hop, forever.
    const second = await middleware({ request: json(location) }, async () => new Response("form"));
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("form");
  });

  it("[CLERK-REV-1] a trailing slash and the sign-in query do not change what the sign-in page is", async () => {
    const middleware = protectedBy(["/(.*)"], "/sign-in?lang=ar");
    const response = await middleware(
      { request: json("/sign-in/?lang=ar&redirect_url=%2Fa") },
      async () => new Response("form"),
    );
    expect(response.status).toBe(200);
  });

  it("[CLERK-REV-1] other protected paths still redirect", async () => {
    const middleware = protectedBy(["/(.*)"], "/sign-in");
    const response = await middleware(
      { request: json("/sign-in-help") },
      async () => new Response("no"),
    );
    expect(response.status).toBe(307);
  });
});

describe("checkServerOptions: the once-per-key warning", () => {
  it("[CLERK-REV-2] the list of warned keys is bounded at 32; a key past the bound is warned about again", () => {
    // vitest.setup.ts already spies on console.warn; this test reads the calls and clears them.
    const warn = vi.mocked(console.warn);
    const keysSeen = Array.from({ length: 40 }, (_, index) =>
      publishableKeyFor(`app-${index}.clerk.accounts.dev`, "test"),
    );
    const options = (publishableKey: string) => ({ secretKey: DEV_SECRET_KEY, publishableKey });
    for (const key of keysSeen) checkServerOptions(options(key));
    expect(warn).toHaveBeenCalledTimes(40);
    warn.mockClear();
    for (const key of keysSeen) checkServerOptions(options(key));
    // The first 32 keys are remembered; the last 8 did not fit and warn again instead of growing the list.
    expect(warn).toHaveBeenCalledTimes(8);
    warn.mockClear();
  });
});
