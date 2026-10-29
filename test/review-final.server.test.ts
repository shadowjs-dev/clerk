import { beforeAll, describe, expect, it } from "vitest";
import { clerkMiddleware } from "../src/server/middleware";
import { createRouteMatcher } from "../src/server/route-matcher";
import {
  APP,
  LIVE_PUBLISHABLE_KEY,
  LIVE_SECRET_KEY,
  makeKeys,
  type TestKeys,
} from "./support/sec2-server";

let keys: TestKeys;

beforeAll(() => {
  keys = makeKeys();
});

describe("clerkMiddleware final review", () => {
  it("[REVIEW-FINAL-CLERK-1] the sign-in exemption does not open a page the framework resolved the request to", async () => {
    const middleware = clerkMiddleware({
      secretKey: LIVE_SECRET_KEY,
      publishableKey: LIVE_PUBLISHABLE_KEY,
      authorizedParties: [APP],
      jwtKey: keys.publicPem,
      protect: { matcher: createRouteMatcher(["/dashboard"]), signInUrl: "/sign-in" },
    });
    const request = new Request(`${APP}/sign-in`, { headers: { accept: "application/json" } });
    // A config rewrite moved the route to /dashboard: `protect` checks event.url too, so this is a protected page.
    const response = await middleware(
      { request, url: new URL(`${APP}/dashboard`) },
      async () => new Response("secret"),
    );
    expect(response.status).toBe(307);
  });
});
