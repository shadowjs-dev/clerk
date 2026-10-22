import { renderToString } from "@shadow-js/web/server";
import { describe, expect, it, vi } from "vitest";
import { ClerkProvider } from "../src/index";
import { clerkJSScriptUrl, frontendApiOf } from "../src/internal/script";

/**
 * Server rendering in script mode. The server has no window and must load nothing: neither Clerk's
 * bundles nor the packages that the bundled mode imports. Both packages are mocked and counted.
 */
const sdk = vi.hoisted(() => ({ reads: 0 }));

vi.mock("@clerk/clerk-js", () => ({
  get Clerk() {
    sdk.reads += 1;
    return class UnusedClerk {};
  },
}));

vi.mock("@clerk/ui", () => ({
  get ui() {
    sdk.reads += 1;
    return { ClerkUI: class UnusedUI {} };
  },
}));

const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

describe("ClerkProvider: script mode on the server", () => {
  it("[CDN-25] renders the children with the unloaded state, touching neither window nor a script", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(() =>
      ClerkProvider({
        publishableKey: KEY,
        mode: "script",
        nonce: "server-nonce",
        clerkJSVersion: "6.38.1",
        get children() {
          return "app";
        },
      }),
    );
    expect(html).toBe("app");
    expect(sdk.reads).toBe(0);
  });

  it("[CDN-26] the URL and host derivation is pure: it runs without a window", () => {
    expect(typeof window).toBe("undefined");
    const host = frontendApiOf(KEY);
    expect(host).toBe("clerk.example.com");
    expect(clerkJSScriptUrl(host, {})).toBe(
      "https://clerk.example.com/npm/@clerk/clerk-js@6/dist/clerk.browser.js",
    );
  });
});
