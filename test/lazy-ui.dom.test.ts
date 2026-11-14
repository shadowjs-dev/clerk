import { cleanup, render, waitFor } from "@shadow-js/testing/dom";
import { ErrorBoundary } from "@shadow-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClerkProvider,
  type ClerkProviderProps,
  SignIn,
  SignInButton,
  useClerk,
  useClerkUi,
  useReverification,
} from "../src/index";
import { FakeClerk } from "./support/fake-clerk";

/*
 * `loadUi`: script mode with the UI bundle deferred ("lazy") or skipped ("never"). clerk-js 6 finishes `load()` without
 * the UI constructor, and takes it as a promise (`ui: { ClerkUI }`), so a provider that defers the bundle passes a
 * promise that resolves when something asks for the components.
 */

vi.mock("@clerk/clerk-js", () => ({ Clerk: class UnusedClerk {} }));
vi.mock("@clerk/ui", () => ({ ui: { ClerkUI: class UnusedUI {} } }));

const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

type Globals = Record<string, unknown>;
const globals = (): Globals => window as unknown as Globals;

let inserted: HTMLScriptElement[] = [];
let appendSpy: { mockRestore: () => void } | undefined;

beforeEach(() => {
  inserted = [];
  appendSpy = vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
    for (const node of nodes) if (node instanceof HTMLScriptElement) inserted.push(node);
  });
});

afterEach(() => {
  cleanup();
  appendSpy?.mockRestore();
  appendSpy = undefined;
  delete globals()["Clerk"];
  delete globals()["__internal_ClerkUICtor"];
  for (const node of document.querySelectorAll(
    "script[data-clerk-js-script], script[data-clerk-ui-script]",
  )) {
    node.remove();
  }
});

const scriptsOf = (kind: "js" | "ui"): HTMLScriptElement[] =>
  inserted.filter((script) =>
    script.hasAttribute(kind === "js" ? "data-clerk-js-script" : "data-clerk-ui-script"),
  );

class FakeClerkUI {}

/** The SDK bundle arrives: its global, then `load` on its element. */
function sdkArrives(clerk: FakeClerk): void {
  globals()["Clerk"] = clerk;
  for (const script of scriptsOf("js")) script.dispatchEvent(new Event("load"));
}

/** The UI bundle arrives. */
function uiArrives(): void {
  globals()["__internal_ClerkUICtor"] = FakeClerkUI;
  for (const script of scriptsOf("ui")) script.dispatchEvent(new Event("load"));
}

interface Probe {
  ui?: ReturnType<typeof useClerkUi>;
  clerk?: ReturnType<typeof useClerk>;
  reverify?: () => Promise<unknown>;
}

/** The answer a server gives when the session must be verified again (Clerk's wire shape). */
const hint = {
  clerk_error: {
    type: "forbidden",
    reason: "reverification-error",
    metadata: { reverification: "strict" },
  },
};

function mount(
  props: Partial<ClerkProviderProps> = {},
  probe: Probe = {},
  children?: () => unknown,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const seen: unknown[] = [];
  const view = render(
    () =>
      ErrorBoundary({
        fallback: (error: unknown) => {
          seen.push(error);
          return `failed:${error instanceof Error ? error.message : "?"}`;
        },
        get children() {
          return ClerkProvider({
            publishableKey: KEY,
            scriptLoadTimeout: 60_000,
            ...props,
            get children() {
              probe.ui = useClerkUi();
              probe.clerk = useClerk();
              const answers = [hint, "done"];
              let runs = 0;
              probe.reverify = useReverification(async () => {
                const answer = answers[Math.min(runs, 1)];
                runs += 1;
                return answer;
              });
              return children === undefined ? "app" : children();
            },
          });
        },
      }),
    { container },
  );
  return { view, container, seen };
}

const uiOptionOf = (clerk: FakeClerk): unknown =>
  (clerk.callsTo("load")[0]?.args[0] as { ui?: { ClerkUI?: unknown } } | undefined)?.ui?.ClerkUI;

describe('ClerkProvider loadUi="lazy" in script mode', () => {
  it("[CUI-1] only clerk.browser.js is inserted, and the page is loaded without waiting for the UI bundle", async () => {
    const clerk = new FakeClerk();
    mount({ loadUi: "lazy" });
    expect(scriptsOf("js")).toHaveLength(1);
    expect(scriptsOf("ui")).toHaveLength(0);
    sdkArrives(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(scriptsOf("ui")).toHaveLength(0);
  });

  it("[CUI-2] clerk.load gets the UI constructor as a promise that stays pending until the bundle is asked for", async () => {
    const clerk = new FakeClerk();
    const probe: Probe = {};
    mount({ loadUi: "lazy", loadOptions: { signInUrl: "/sign-in" } }, probe);
    sdkArrives(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    const given = uiOptionOf(clerk);
    expect(given).toBeInstanceOf(Promise);
    let settled = false;
    void (given as Promise<unknown>).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    const options = clerk.callsTo("load")[0]?.args[0] as { signInUrl?: string };
    expect(options.signInUrl).toBe("/sign-in");
    const loading = probe.ui?.load();
    uiArrives();
    await loading;
    expect(await given).toBe(FakeClerkUI);
  });

  it("[CUI-3] useClerkUi().load() inserts the UI script once for several calls and resolves when the global is defined", async () => {
    const clerk = new FakeClerk();
    const probe: Probe = {};
    mount({ loadUi: "lazy" }, probe);
    sdkArrives(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(probe.ui?.ready()).toBe(false);
    const first = probe.ui?.load();
    const second = probe.ui?.load();
    expect(scriptsOf("ui")).toHaveLength(1);
    uiArrives();
    await Promise.all([first, second]);
    expect(probe.ui?.ready()).toBe(true);
    await probe.ui?.load();
    expect(scriptsOf("ui")).toHaveLength(1);
  });

  it("[CUI-4] a Clerk component mounts after the UI bundle arrives, not before", async () => {
    const clerk = new FakeClerk();
    mount({ loadUi: "lazy" }, {}, () => SignIn({}));
    sdkArrives(clerk);
    await waitFor(() => {
      expect(scriptsOf("ui")).toHaveLength(1);
    });
    expect(clerk.count("mountSignIn")).toBe(0);
    uiArrives();
    await waitFor(() => {
      expect(clerk.count("mountSignIn")).toBe(1);
    });
  });

  it("[CUI-5] a modal sign-in button asks for the bundle on the click and opens the dialog after it arrives", async () => {
    const clerk = new FakeClerk();
    const { container } = mount({ loadUi: "lazy" }, {}, () => SignInButton({ children: "Go" }));
    sdkArrives(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(scriptsOf("ui")).toHaveLength(0);
    container.querySelector("button")?.click();
    await waitFor(() => {
      expect(scriptsOf("ui")).toHaveLength(1);
    });
    expect(clerk.count("openSignIn")).toBe(0);
    uiArrives();
    await waitFor(() => {
      expect(clerk.count("openSignIn")).toBe(1);
    });
  });

  it("[CUI-6] a redirect sign-in button never loads the bundle", async () => {
    const clerk = new FakeClerk();
    const { container } = mount({ loadUi: "lazy" }, {}, () =>
      SignInButton({ mode: "redirect", children: "Go" }),
    );
    sdkArrives(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    container.querySelector("button")?.click();
    await waitFor(() => {
      expect(clerk.count("redirectToSignIn")).toBe(1);
    });
    expect(scriptsOf("ui")).toHaveLength(0);
  });

  it("[CUI-7] a re-verification asks for the bundle before it opens the dialog", async () => {
    const clerk = new FakeClerk();
    const probe: Probe = {};
    mount({ loadUi: "lazy" }, probe);
    sdkArrives(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    const done = probe.reverify?.();
    await waitFor(() => {
      expect(scriptsOf("ui")).toHaveLength(1);
    });
    expect(clerk.count("__internal_openReverification")).toBe(0);
    uiArrives();
    expect(await done).toBe("done");
    expect(clerk.count("__internal_openReverification")).toBe(1);
  });

  it("[CUI-8] a bundle that fails twice rejects load() with the script's error, and a later load() tries again", async () => {
    const clerk = new FakeClerk();
    const probe: Probe = {};
    mount({ loadUi: "lazy" }, probe);
    sdkArrives(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    const failed = probe.ui?.load();
    const caught = failed?.then(
      () => undefined,
      (error: unknown) => error,
    );
    scriptsOf("ui")[0]?.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(scriptsOf("ui")).toHaveLength(2);
    });
    scriptsOf("ui")[1]?.dispatchEvent(new Event("error"));
    expect(String(await caught)).toContain("could not load ui.browser.js from clerk.example.com");
    const again = probe.ui?.load();
    await waitFor(() => {
      expect(scriptsOf("ui")).toHaveLength(3);
    });
    uiArrives();
    await again;
    expect(probe.ui?.ready()).toBe(true);
  });

  it("[CUI-9] a component whose bundle fails reaches the nearest ErrorBoundary", async () => {
    const clerk = new FakeClerk();
    const { container } = mount({ loadUi: "lazy" }, {}, () => SignIn({}));
    sdkArrives(clerk);
    await waitFor(() => {
      expect(scriptsOf("ui")).toHaveLength(1);
    });
    scriptsOf("ui")[0]?.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(scriptsOf("ui")).toHaveLength(2);
    });
    scriptsOf("ui")[1]?.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(container.textContent).toContain("could not load ui.browser.js");
    });
    expect(clerk.count("mountSignIn")).toBe(0);
  });

  it("[CUI-10] unmounting while the bundle is pending cancels the mount", async () => {
    const clerk = new FakeClerk();
    const { view } = mount({ loadUi: "lazy" }, {}, () => SignIn({}));
    sdkArrives(clerk);
    await waitFor(() => {
      expect(scriptsOf("ui")).toHaveLength(1);
    });
    view.unmount();
    uiArrives();
    await Promise.resolve();
    await Promise.resolve();
    expect(clerk.count("mountSignIn")).toBe(0);
  });

  it("[CUI-11] a UI constructor the app passes in loadOptions.ui is kept: it wins over the deferred one", async () => {
    const clerk = new FakeClerk();
    const own = class OwnUI {};
    mount({ loadUi: "lazy", loadOptions: { ui: { ClerkUI: own } } });
    sdkArrives(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(uiOptionOf(clerk)).toBe(own);
  });
});

describe('ClerkProvider loadUi="never" in script mode', () => {
  it("[CUI-12] the UI bundle is never inserted and clerk.load gets no UI constructor", async () => {
    const clerk = new FakeClerk();
    mount({ loadUi: "never" });
    expect(scriptsOf("ui")).toHaveLength(0);
    sdkArrives(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(uiOptionOf(clerk)).toBeUndefined();
    expect(scriptsOf("ui")).toHaveLength(0);
  });

  it("[CUI-13] load() rejects and a Clerk component reaches the boundary, both naming the prop", async () => {
    const clerk = new FakeClerk();
    const probe: Probe = {};
    const { container } = mount({ loadUi: "never" }, probe);
    sdkArrives(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    await expect(probe.ui?.load()).rejects.toThrow('loadUi="never"');
    expect(probe.ui?.ready()).toBe(false);
    cleanup();
    const second = mount({ loadUi: "never" }, {}, () => SignIn({}));
    await waitFor(() => {
      expect(second.container.textContent).toContain('loadUi="never"');
    });
    expect(container).toBeDefined();
  });
});

describe("ClerkProvider loadUi: the default and the checks", () => {
  it("[CUI-14] the default is eager: both bundles load, clerk.load waits for the UI constructor, and load() resolves at once", async () => {
    const clerk = new FakeClerk();
    const probe: Probe = {};
    mount({}, probe);
    expect(scriptsOf("ui")).toHaveLength(1);
    sdkArrives(clerk);
    await Promise.resolve();
    expect(clerk.callsTo("load")).toHaveLength(0);
    uiArrives();
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(uiOptionOf(clerk)).toBe(FakeClerkUI);
    expect(probe.ui?.ready()).toBe(true);
    await probe.ui?.load();
  });

  it("[CUI-15] an unknown loadUi is refused before any script is inserted, without echoing it", () => {
    const container = document.createElement("div");
    document.body.append(container);
    let thrown: unknown;
    try {
      render(
        () =>
          ClerkProvider({
            publishableKey: KEY,
            loadUi: "idle" as unknown as "lazy",
            get children() {
              return "app";
            },
          }),
        { container },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).toContain('loadUi must be "eager", "lazy" or "never"');
    expect(String(thrown)).not.toContain("idle");
    expect(inserted).toEqual([]);
  });

  it("[CUI-16] an injected clerk instance ignores loadUi: it brings its own UI, and load() resolves at once", async () => {
    const clerk = new FakeClerk();
    const probe: Probe = {};
    mount({ loadUi: "never", clerk }, probe);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(probe.ui?.ready()).toBe(true);
    await probe.ui?.load();
    expect(inserted).toEqual([]);
  });
});
