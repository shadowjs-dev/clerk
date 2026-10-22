import { type ConvexClientLike, useConvexAuth } from "@shadow-js/convex";
import { createRoot, flushSync } from "@shadow-js/core";
import { flush } from "@shadow-js/testing";
import { describe, expect, it } from "vitest";
import { ConvexProviderWithClerk } from "../src/convex-react";
import { ClerkProvider } from "../src/provider";
import { FakeClerk, FakeSession, fakeUser } from "./support/fake-clerk";

const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

type Fetcher = (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>;

/** A Convex client that records the auth registration, so the test drives the token and the server's answer. */
class FakeConvex implements ConvexClientLike {
  readonly fetchers: Fetcher[] = [];
  readonly onChange: Array<((authenticated: boolean) => void) | undefined> = [];
  clears = 0;

  onUpdate(): () => void {
    return () => undefined;
  }

  mutation(): Promise<never> {
    return Promise.reject(new Error("not used"));
  }

  action(): Promise<never> {
    return Promise.reject(new Error("not used"));
  }

  setAuth(fetchToken: Fetcher, onChange?: (authenticated: boolean) => void): void {
    this.fetchers.push(fetchToken);
    this.onChange.push(onChange);
  }

  clearAuth(): void {
    this.clears += 1;
  }
}

/** Mounts Clerk, the Clerk-backed Convex provider, and a probe of the Convex auth state. */
function mountApp(clerk: FakeClerk, client: ConvexClientLike, template?: string) {
  const box: { auth?: ReturnType<typeof useConvexAuth>; dispose?: () => void } = {};
  box.dispose = createRoot((dispose) => {
    ClerkProvider({
      publishableKey: KEY,
      clerk,
      get children() {
        return ConvexProviderWithClerk({
          client,
          ...(template === undefined ? {} : { template }),
          get children() {
            box.auth = useConvexAuth();
            return null;
          },
        });
      },
    });
    return dispose;
  });
  flushSync();
  return box;
}

describe("ConvexProviderWithClerk", () => {
  it("[CVP-1] registers the convex template token once a user is signed in, and not before", async () => {
    const clerk = new FakeClerk();
    const convex = new FakeConvex();
    const box = mountApp(clerk, convex);
    await flush();
    expect(convex.fetchers.length).toBe(0);
    const session = new FakeSession("sess_1");
    clerk.set({ user: fakeUser("user_1"), session });
    flushSync();
    expect(convex.fetchers.length).toBe(1);
    const token = await convex.fetchers[0]?.({ forceRefreshToken: false });
    expect(token).toBe("token-1");
    expect(session.tokenCalls).toEqual([{ template: "convex", skipCache: false }]);
    box.dispose?.();
  });

  it("[CVP-2] a forced refresh asks Clerk to skip its cache", async () => {
    const clerk = new FakeClerk();
    const convex = new FakeConvex();
    const session = new FakeSession("sess_2");
    const box = mountApp(clerk, convex);
    await flush();
    clerk.set({ user: fakeUser("user_1"), session });
    flushSync();
    await convex.fetchers[0]?.({ forceRefreshToken: true });
    expect(session.tokenCalls.at(-1)).toEqual({ template: "convex", skipCache: true });
    box.dispose?.();
  });

  it("[CVP-3] the server's confirmation drives useConvexAuth().isAuthenticated", async () => {
    const clerk = new FakeClerk();
    const convex = new FakeConvex();
    const box = mountApp(clerk, convex);
    await flush();
    clerk.set({ user: fakeUser("user_1"), session: new FakeSession("sess_3") });
    flushSync();
    expect(box.auth?.isLoading()).toBe(true);
    convex.onChange[0]?.(true);
    flushSync();
    expect(box.auth?.isAuthenticated()).toBe(true);
    expect(box.auth?.isLoading()).toBe(false);
    box.dispose?.();
  });

  it("[CVP-4] a template option replaces the default name in every token request", async () => {
    const clerk = new FakeClerk();
    const convex = new FakeConvex();
    const session = new FakeSession("sess_4");
    const box = mountApp(clerk, convex, "jwt-convex");
    await flush();
    clerk.set({ user: fakeUser("user_1"), session });
    flushSync();
    await convex.fetchers[0]?.({ forceRefreshToken: false });
    expect(session.tokenCalls).toEqual([{ template: "jwt-convex", skipCache: false }]);
    box.dispose?.();
  });

  it("[CVP-5] signing out removes the token from the Convex client", async () => {
    const clerk = new FakeClerk();
    const convex = new FakeConvex();
    const box = mountApp(clerk, convex);
    await flush();
    clerk.set({ user: fakeUser("user_1"), session: new FakeSession("sess_5") });
    flushSync();
    clerk.set({ user: null, session: null });
    flushSync();
    expect(convex.clears).toBe(1);
    expect(box.auth?.isAuthenticated()).toBe(false);
    box.dispose?.();
  });
});
