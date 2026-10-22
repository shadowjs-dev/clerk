import { cleanup, flush, render, waitFor } from "@shadow-js/testing/dom";
import { ErrorBoundary } from "@shadow-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClerkProvider, useAuth } from "../src/index";
import { FakeClerk, FakeSession, fakeUser } from "./support/fake-clerk";

/**
 * Control of the mocked `@clerk/clerk-js`. Vitest caches a mocked module after its first import, so
 * the failure modes are read at access time: the `Clerk` export is a getter that throws while
 * `failure` is set and is `undefined` while `missingExport` is set. `instance` is what
 * `new Clerk(key)` returns. Each test sets these flags; no module reset is needed.
 */
const sdk = vi.hoisted(() => ({
  /** Times the `Clerk` export was read: one per provider import that resolved. */
  accesses: 0,
  keys: [] as string[],
  instance: undefined as object | undefined,
  failure: undefined as { readonly error: unknown } | undefined,
  missingExport: false,
}));

vi.mock("@clerk/clerk-js", () => {
  class MockClerk {
    constructor(key: string) {
      sdk.keys.push(key);
      if (sdk.instance === undefined) throw new Error("no instance configured");
      // biome-ignore lint/correctness/noConstructorReturn: the SDK's constructor hands back the instance it created; the mock does the same
      return sdk.instance;
    }
  }
  return {
    get Clerk() {
      sdk.accesses += 1;
      if (sdk.failure !== undefined) throw sdk.failure.error;
      return sdk.missingExport ? undefined : MockClerk;
    },
  };
});

/**
 * The UI bundle that `clerk.load()` needs for mounted components, from the optional peer `@clerk/ui`.
 * `failure` makes the module read throw, which is what a missing package does at import time.
 */
const ui = vi.hoisted(() => ({
  ClerkUI: class FakeClerkUI {},
  failure: undefined as { readonly error: unknown } | undefined,
}));

vi.mock("@clerk/ui", () => ({
  get ui() {
    if (ui.failure !== undefined) throw ui.failure.error;
    return { ClerkUI: ui.ClerkUI };
  },
}));

const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

beforeEach(() => {
  sdk.accesses = 0;
  sdk.keys.length = 0;
  sdk.failure = undefined;
  sdk.missingExport = false;
  ui.failure = undefined;
});

afterEach(() => cleanup());

/** Mounts a provider without an injected instance, inside a boundary whose fallback records errors. */
function mountLazy(seen: unknown[], reset: { current?: () => void } = {}): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(
    () =>
      ErrorBoundary({
        fallback: (error: unknown, retry: () => void) => {
          seen.push(error);
          reset.current = retry;
          return `failed:${error instanceof Error ? error.message : "?"}`;
        },
        get children() {
          return ClerkProvider({
            publishableKey: KEY,
            mode: "bundled",
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

describe("ClerkProvider: bundled mode, lazy loading of @clerk/clerk-js", () => {
  it("[LZY-07] the SDK is loaded with the Clerk UI bundle, and the caller's load options are kept", async () => {
    const clerk = new FakeClerk();
    sdk.instance = clerk;
    const container = document.createElement("div");
    document.body.append(container);
    render(
      () =>
        ClerkProvider({
          publishableKey: KEY,
          mode: "bundled",
          loadOptions: { signInUrl: "/sign-in" },
          get children() {
            return "app";
          },
        }),
      { container },
    );
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    const [call] = clerk.callsTo("load");
    const options = call?.args[0] as { signInUrl?: string; ui?: { ClerkUI?: unknown } } | undefined;
    expect(options?.signInUrl).toBe("/sign-in");
    expect(options?.ui?.ClerkUI).toBe(ui.ClerkUI);
  });

  it("[LZY-08] a missing @clerk/ui is reported by name, and the boundary shows it", async () => {
    sdk.instance = new FakeClerk();
    ui.failure = { error: new Error("Cannot find package '@clerk/ui'") };
    const container = mountLazy([]);
    await waitFor(() => {
      expect(container.textContent).toContain("@clerk/ui");
    });
  });

  it("[LZY-01] importing the package and rendering nothing loads no SDK", () => {
    expect(sdk.accesses).toBe(0);
  });

  it("[LZY-02] mounting a provider loads the SDK and constructs it with the publishable key", async () => {
    sdk.instance = new FakeClerk();
    const seen: unknown[] = [];
    mountLazy(seen);
    expect(sdk.accesses).toBe(0);
    await waitFor(() => {
      expect(sdk.keys).toEqual([KEY]);
    });
    expect(sdk.accesses).toBe(1);
  });

  it("[LZY-03] the constructed instance is loaded, subscribed and mirrored", async () => {
    const clerk = new FakeClerk();
    sdk.instance = clerk;
    const seen: { isLoaded(): boolean; userId(): string | null }[] = [];
    mountLazy(seen);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(clerk.listeners.size).toBe(1);
    clerk.set({ user: fakeUser("user_lazy"), session: new FakeSession("sess_lazy") });
    await flush();
    const last = seen[seen.length - 1];
    expect(last && typeof last === "object" && "userId" in last ? last.userId() : null).toBe(
      "user_lazy",
    );
  });

  it("[LZY-04] each provider constructs its own instance from the shared SDK module", async () => {
    sdk.instance = new FakeClerk();
    mountLazy([]);
    await waitFor(() => {
      expect(sdk.keys).toEqual([KEY]);
    });
    mountLazy([]);
    await waitFor(() => {
      expect(sdk.keys).toEqual([KEY, KEY]);
    });
  });

  it("[LZY-05] a failed import is thrown to the nearest ErrorBoundary", async () => {
    sdk.failure = { error: new Error("chunk 404") };
    const seen: unknown[] = [];
    const container = mountLazy(seen);
    await waitFor(() => {
      expect(container.textContent).toBe("failed:chunk 404");
    });
  });

  it("[LZY-06] after the boundary resets, the provider retries the import and succeeds", async () => {
    sdk.failure = { error: new Error("flaky") };
    const seen: unknown[] = [];
    const reset: { current?: () => void } = {};
    const container = mountLazy(seen, reset);
    await waitFor(() => {
      expect(container.textContent).toBe("failed:flaky");
    });
    sdk.failure = undefined;
    sdk.instance = new FakeClerk();
    reset.current?.();
    await waitFor(() => {
      expect(container.textContent).toBe("app");
    });
  });

  it("[LZY-07] a module without a Clerk export fails the provider with a TypeError", async () => {
    sdk.missingExport = true;
    const seen: unknown[] = [];
    const container = mountLazy(seen);
    await waitFor(() => {
      expect(container.textContent).toMatch(/^failed:/);
    });
    expect(seen.some((item) => item instanceof TypeError)).toBe(true);
  });

  it("[LZY-08] an unmounted provider does not construct an instance when its import resolves", async () => {
    sdk.instance = new FakeClerk();
    const container = document.createElement("div");
    document.body.append(container);
    const view = render(
      () =>
        ClerkProvider({
          publishableKey: KEY,
          mode: "bundled",
          get children() {
            return "app";
          },
        }),
      { container },
    );
    view.unmount();
    await waitFor(() => {
      expect(sdk.accesses).toBe(1);
    });
    await flush();
    expect(sdk.keys).toEqual([]);
  });
});
