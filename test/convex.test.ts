import { createRoot, flushSync } from "@shadow-js/core";
import { flush } from "@shadow-js/testing";
import { describe, expect, it, vi } from "vitest";
import { type ConvexAuthState, clerkConvexAuth } from "../src/convex";
import { ClerkProvider } from "../src/provider";
import { FakeClerk, FakeSession, fakeUser } from "./support/fake-clerk";

const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

/**
 * Runs the Convex auth hook under a provider in a plain (no DOM) root. The hook's result is
 * returned, and the root is disposed by the caller.
 */
function runConvexHook(clerk: FakeClerk, hook: () => ConvexAuthState) {
  const box: { state?: ConvexAuthState; dispose?: () => void } = {};
  box.dispose = createRoot((dispose) => {
    ClerkProvider({
      publishableKey: KEY,
      clerk,
      get children() {
        box.state = hook();
        return null;
      },
    });
    return dispose;
  });
  flushSync();
  if (box.state === undefined) throw new Error("hook did not run");
  return { state: box.state, dispose: box.dispose };
}

describe("clerkConvexAuth: the ConvexProviderWithAuth shape", () => {
  it("[CNV-01] returns a hook function that yields the documented shape", async () => {
    const clerk = new FakeClerk();
    const useConvexAuth = clerkConvexAuth();
    expect(typeof useConvexAuth).toBe("function");
    const { state, dispose } = runConvexHook(clerk, useConvexAuth);
    expect(typeof state.fetchAccessToken).toBe("function");
    expect(Object.keys(state).sort()).toEqual(["fetchAccessToken", "isAuthenticated", "isLoading"]);
    dispose();
  });

  it("[CNV-02] isLoading is true until Clerk has loaded, then false", async () => {
    const clerk = new FakeClerk();
    const { state, dispose } = runConvexHook(clerk, clerkConvexAuth());
    expect(state.isLoading).toBe(true);
    await flush();
    expect(state.isLoading).toBe(false);
    dispose();
  });

  it("[CNV-03] isAuthenticated follows the active session", async () => {
    const clerk = new FakeClerk();
    const { state, dispose } = runConvexHook(clerk, clerkConvexAuth());
    await flush();
    expect(state.isAuthenticated).toBe(false);
    clerk.set({ user: fakeUser("user_1"), session: new FakeSession("sess_1") });
    expect(state.isAuthenticated).toBe(true);
    dispose();
  });

  it("[CNV-04] fetchAccessToken requests the convex template with skipCache false by default", async () => {
    const clerk = new FakeClerk();
    const { state, dispose } = runConvexHook(clerk, clerkConvexAuth());
    await flush();
    const session = new FakeSession("sess_2");
    clerk.set({ user: fakeUser("user_2"), session });
    await expect(state.fetchAccessToken({ forceRefreshToken: false })).resolves.toBe("token-1");
    expect(session.tokenCalls).toEqual([{ template: "convex", skipCache: false }]);
    dispose();
  });

  it("[CNV-05] forceRefreshToken true skips the token cache", async () => {
    const clerk = new FakeClerk();
    const { state, dispose } = runConvexHook(clerk, clerkConvexAuth());
    await flush();
    const session = new FakeSession("sess_3");
    clerk.set({ user: fakeUser("user_3"), session });
    await state.fetchAccessToken({ forceRefreshToken: true });
    expect(session.tokenCalls).toEqual([{ template: "convex", skipCache: true }]);
    dispose();
  });

  it("[CNV-06] a custom template name is used for the token request", async () => {
    const clerk = new FakeClerk();
    const { state, dispose } = runConvexHook(clerk, clerkConvexAuth({ template: "my-convex" }));
    await flush();
    const session = new FakeSession("sess_4");
    clerk.set({ user: fakeUser("user_4"), session });
    await state.fetchAccessToken({ forceRefreshToken: false });
    expect(session.tokenCalls).toEqual([{ template: "my-convex", skipCache: false }]);
    dispose();
  });

  it("[CNV-07] fetchAccessToken resolves null when signed out", async () => {
    const clerk = new FakeClerk();
    const { state, dispose } = runConvexHook(clerk, clerkConvexAuth());
    await flush();
    await expect(state.fetchAccessToken({ forceRefreshToken: false })).resolves.toBeNull();
    dispose();
  });

  it("[CNV-08] a failed token request resolves to null: Convex is told no token exists, and the socket is not left paused", async () => {
    const clerk = new FakeClerk();
    const { state, dispose } = runConvexHook(clerk, clerkConvexAuth());
    await flush();
    const session = new FakeSession("sess_5");
    session.failure = { error: new Error("token service down") };
    clerk.set({ user: fakeUser("user_5"), session });
    await expect(state.fetchAccessToken({ forceRefreshToken: false })).resolves.toBeNull();
    const warnings = vi.mocked(console.warn).mock.calls;
    expect(warnings.length).toBe(1);
    expect(String(warnings[0]?.[0])).toContain("the Convex token request failed");
    vi.mocked(console.warn).mockClear();
    dispose();
  });

  it("[CNV-09] each call to the hook returns a fresh state object over the same Clerk state", async () => {
    const clerk = new FakeClerk();
    const hook = clerkConvexAuth();
    const first = runConvexHook(clerk, hook);
    const second = runConvexHook(clerk, hook);
    expect(first.state).not.toBe(second.state);
    first.dispose();
    second.dispose();
  });

  it("[CNV-10] the template defaults to convex when options are omitted", async () => {
    const clerk = new FakeClerk();
    const { state, dispose } = runConvexHook(clerk, clerkConvexAuth({}));
    await flush();
    const session = new FakeSession("sess_6");
    clerk.set({ user: fakeUser("user_6"), session });
    await state.fetchAccessToken({ forceRefreshToken: false });
    expect(session.tokenCalls[0]?.template).toBe("convex");
    dispose();
  });
});
