import { cleanup, flush, render } from "@shadow-js/testing/dom";
import { ErrorBoundary } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { type AuthState, useAuth, useClerk } from "../src/index";
import { ClerkProvider } from "../src/provider";
import { KEY, LIVE_KEY, mountProvider } from "./support/app";
import { FakeClerk, FakeSession, fakeUser } from "./support/fake-clerk";

afterEach(() => cleanup());

describe("ClerkProvider: rendering before Clerk is ready", () => {
  it("[PRV-01] renders its children immediately, before Clerk has loaded", () => {
    const clerk = new FakeClerk();
    const { view } = mountProvider(() => useAuth(), { clerk });
    expect(view.container.textContent).toBe("app");
    expect(clerk.loaded).toBe(false);
  });

  it("[PRV-02] children read the provider state through the hooks (not undefined)", () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useAuth(), { clerk });
    expect(value.isLoaded()).toBe(false);
    expect(value.isSignedIn()).toBe(false);
  });

  it("[PRV-03] renders the children once: they are not rebuilt by later Clerk events", async () => {
    const clerk = new FakeClerk();
    let builds = 0;
    mountProvider(
      () => {
        builds += 1;
        return useAuth();
      },
      { clerk },
    );
    await flush();
    clerk.set({ user: fakeUser("user_1") });
    clerk.set({ user: fakeUser("user_2") });
    await flush();
    expect(builds).toBe(1);
  });
});

describe("ClerkProvider: injected instances", () => {
  it("[PRV-04] subscribes with addListener and receives the initial emission", () => {
    const clerk = new FakeClerk();
    clerk.user = fakeUser("user_init");
    mountProvider(() => useAuth(), { clerk });
    expect(clerk.count("addListener")).toBe(1);
    expect(clerk.listeners.size).toBe(1);
  });

  it("[PRV-05] calls load() with loadOptions when the injected instance is not loaded", async () => {
    const clerk = new FakeClerk();
    const options = { signInUrl: "/sign-in", appearance: { variables: {} } };
    mountProvider(() => useAuth(), { clerk, loadOptions: options });
    expect(clerk.callsTo("load")).toEqual([{ method: "load", args: [options] }]);
    await flush();
    expect(clerk.loaded).toBe(true);
  });

  it("[PRV-06] does not call load() again when the injected instance is already loaded", async () => {
    const clerk = new FakeClerk();
    clerk.loaded = true;
    mountProvider(() => useAuth(), { clerk });
    await flush();
    expect(clerk.count("load")).toBe(0);
  });

  it("[PRV-07] isLoaded becomes true only after load() resolves and flushes", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useAuth(), { clerk });
    expect(value.isLoaded()).toBe(false);
    await flush();
    expect(value.isLoaded()).toBe(true);
  });

  it("[PRV-08] useClerk() is null until Clerk has loaded, then the instance", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useClerk(), { clerk });
    expect(value()).toBeNull();
    await flush();
    expect(value()).toBe(clerk);
  });

  it("[PRV-09] accepts a live publishable key as well as a test key", () => {
    const clerk = new FakeClerk();
    expect(() => mountProvider(() => useAuth(), { clerk, publishableKey: LIVE_KEY })).not.toThrow();
  });

  it("[PRV-10] rejects a key that is not a Clerk publishable key, without echoing it", () => {
    const secret = "sk_test_do_not_print_this";
    const error = captureRender(() => mountProvider(() => useAuth(), { publishableKey: secret }));
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).toContain("publishableKey must be a Clerk publishable key");
    expect(String(error)).not.toContain(secret);
  });

  it("[PRV-11] rejects an empty publishable key", () => {
    const error = captureRender(() => mountProvider(() => useAuth(), { publishableKey: "" }));
    expect(error).toBeInstanceOf(TypeError);
  });

  it("[PRV-12] rejects a key with the wrong prefix", () => {
    const error = captureRender(() =>
      mountProvider(() => useAuth(), { publishableKey: "pk_dev_Y2xlcmsuZXhhbXBsZS5jb20k" }),
    );
    expect(error).toBeInstanceOf(TypeError);
  });

  it("[PRV-13] rejects a key with characters outside the base64 alphabet", () => {
    const error = captureRender(() =>
      mountProvider(() => useAuth(), { publishableKey: "pk_test_has spaces" }),
    );
    expect(error).toBeInstanceOf(TypeError);
  });
});

describe("ClerkProvider: subscriptions and disposal", () => {
  it("[PRV-14] disposing the provider unsubscribes its listener", () => {
    const clerk = new FakeClerk();
    const { view } = mountProvider(() => useAuth(), { clerk });
    expect(clerk.listeners.size).toBe(1);
    view.unmount();
    expect(clerk.listeners.size).toBe(0);
  });

  it("[PRV-15] events after disposal do not update the state read before disposal", async () => {
    const clerk = new FakeClerk();
    const { value, view } = mountProvider(() => useAuth(), { clerk });
    await flush();
    view.unmount();
    clerk.set({ user: fakeUser("user_late"), session: new FakeSession("sess_late") });
    expect(value.isSignedIn()).toBe(false);
    expect(value.userId()).toBeNull();
  });

  it("[PRV-16] a load that finishes after disposal does not start a listener on the instance", async () => {
    const clerk = new FakeClerk();
    const { view } = mountProvider(() => useAuth(), { clerk });
    view.unmount();
    await flush();
    expect(clerk.listeners.size).toBe(0);
  });

  it("[PRV-17] a second dispose is harmless", () => {
    const clerk = new FakeClerk();
    const { view } = mountProvider(() => useAuth(), { clerk });
    view.unmount();
    expect(() => view.unmount()).not.toThrow();
    expect(clerk.listeners.size).toBe(0);
  });

  it("[PRV-18] the state is reset to the initial values when a new provider mounts", async () => {
    const first = new FakeClerk();
    first.user = fakeUser("user_1");
    first.session = new FakeSession("sess_1");
    const a = mountProvider(() => useAuth(), { clerk: first });
    await flush();
    expect(a.value.userId()).toBe("user_1");
    a.view.unmount();
    const second = new FakeClerk();
    const b = mountProvider(() => useAuth(), { clerk: second });
    expect(b.value.userId()).toBeNull();
    expect(b.value.isLoaded()).toBe(false);
  });
});

describe("ClerkProvider: load failures and ErrorBoundary", () => {
  it("[PRV-19] a rejected load() throws the error into the nearest ErrorBoundary", async () => {
    const clerk = new FakeClerk();
    clerk.loadFailure = { error: new Error("network down") };
    const boundary = renderWithBoundary(clerk);
    await flush();
    expect(boundary.textContent).toBe("fallback:network down");
  });

  it("[PRV-20] a load failure does not reach the state: isLoaded stays false", async () => {
    const clerk = new FakeClerk();
    clerk.loadFailure = { error: new Error("boom") };
    const seen: AuthState[] = [];
    const boundary = renderWithBoundary(clerk, seen);
    await flush();
    expect(boundary.textContent).toBe("fallback:boom");
    expect(seen.length).toBe(1);
    expect(seen[0]?.isLoaded()).toBe(false);
  });

  it("[PRV-21] a synchronous throw from addListener is routed to the boundary, not thrown past it", async () => {
    const clerk = new FakeClerk();
    clerk.addListener = () => {
      throw new Error("listener broke");
    };
    const boundary = renderWithBoundary(clerk);
    await flush();
    expect(boundary.textContent).toBe("fallback:listener broke");
  });
});

describe("ClerkProvider: load and listener options", () => {
  it("[PRV-23] listens without skipping the initial emission", () => {
    const clerk = new FakeClerk();
    mountProvider(() => useAuth(), { clerk });
    expect(clerk.listenerOptions).toEqual([undefined]);
  });

  it("[PRV-24] passes undefined loadOptions when none are given", async () => {
    const clerk = new FakeClerk();
    mountProvider(() => useAuth(), { clerk });
    expect(clerk.callsTo("load")[0]?.args).toEqual([undefined]);
    await flush();
  });

  it("[PRV-25] the state is the same object whether read before or after load", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useAuth(), { clerk });
    const before: AuthState = value;
    await flush();
    expect(before).toBe(value);
  });
});

/** Runs `fn` and returns what it threw, or fails the test when it did not throw. */
function captureRender(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the render to throw");
}

/**
 * Renders the provider inside an ErrorBoundary whose fallback shows the error message, and returns
 * the container. Used to prove that load failures reach the boundary.
 */
function renderWithBoundary(clerk: FakeClerk, seen: AuthState[] = []): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(
    () =>
      ErrorBoundary({
        fallback: (error: unknown) =>
          `fallback:${error instanceof Error ? error.message : String(error)}`,
        get children() {
          return ClerkProvider({
            publishableKey: KEY,
            clerk,
            get children() {
              seen.push(useAuth());
              return "app";
            },
          });
        },
      }),
    { container },
  );
  return container;
}

describe("ClerkProvider: sign-ins made in another tab", () => {
  const focusTab = (): void => {
    window.dispatchEvent(new Event("focus"));
  };

  it("[PRV-26] a signed-out tab reloads its client when it gets focus, and shows the new session", async () => {
    const clerk = new FakeClerk();
    clerk.loaded = true;
    const { value } = mountProvider(() => useAuth(), { clerk });
    await flush();
    expect(value.isSignedIn()).toBe(false);
    // Another tab signed in: the reload is what makes Clerk emit the new resources.
    clerk.reloadEffect = () => {
      clerk.set({ user: fakeUser("user_other_tab"), session: new FakeSession("active") });
    };
    focusTab();
    await flush();
    expect(clerk.count("__internal_reloadInitialResources")).toBe(1);
    expect(value.isSignedIn()).toBe(true);
  });

  it("[PRV-29] the reload only makes the session known: the provider makes it active, last used first", async () => {
    const clerk = new FakeClerk();
    clerk.loaded = true;
    mountProvider(() => useAuth(), { clerk });
    await flush();
    clerk.reloadEffect = () => {
      clerk.client = {
        lastActiveSessionId: "sess_b",
        signedInSessions: [{ id: "sess_a" }, { id: "sess_b" }],
      };
    };
    focusTab();
    await flush();
    await flush();
    expect(clerk.callsTo("setActive").map((call) => call.args[0])).toEqual([{ session: "sess_b" }]);
  });

  it("[PRV-27] a signed-in tab never reloads on focus, and two focus events within two seconds reload once", async () => {
    const signedIn = new FakeClerk();
    signedIn.loaded = true;
    signedIn.user = fakeUser("user_a");
    signedIn.session = new FakeSession("active");
    mountProvider(() => useAuth(), { clerk: signedIn });
    await flush();
    focusTab();
    expect(signedIn.count("__internal_reloadInitialResources")).toBe(0);
    cleanup();

    const signedOut = new FakeClerk();
    signedOut.loaded = true;
    mountProvider(() => useAuth(), { clerk: signedOut });
    await flush();
    focusTab();
    focusTab();
    expect(signedOut.count("__internal_reloadInitialResources")).toBe(1);
  });

  it("[PRV-28] the focus listeners come off when the provider is disposed", async () => {
    const clerk = new FakeClerk();
    clerk.loaded = true;
    mountProvider(() => useAuth(), { clerk });
    await flush();
    cleanup();
    focusTab();
    expect(clerk.count("__internal_reloadInitialResources")).toBe(0);
  });
});
