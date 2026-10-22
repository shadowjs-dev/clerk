import { cleanup, render, waitFor } from "@shadow-js/testing/dom";
import { ErrorBoundary } from "@shadow-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClerkProvider,
  type ClerkProviderMode,
  type ClerkProviderProps,
  useAuth,
} from "../src/index";
import { FakeClerk } from "./support/fake-clerk";

/**
 * Script mode: the provider inserts Clerk's own bundles as `<script>` elements. happy-dom would fetch
 * them for real, so `document.head.append` is spied on and the elements it receives are kept here.
 * The tests then play the browser: they set the globals the bundles define and dispatch `load` or
 * `error` on the element. `@clerk/clerk-js` and `@clerk/ui` are mocked and counted: script mode must
 * read neither.
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

/** The publishable key of a host that is safe to print: `clerk.example.com$`, base64. */
const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
const HOST = "clerk.example.com";
const CLERK_JS_URL = `https://${HOST}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
const CLERK_UI_URL = `https://${HOST}/npm/@clerk/ui@1/dist/ui.browser.js`;

type Globals = Record<string, unknown>;

function globals(): Globals {
  return window as unknown as Globals;
}

/** Every script element the provider tried to insert, in order. */
let inserted: HTMLScriptElement[] = [];
/** The spy on the head's append. Restored alone: the shared setup reads the console spies after this file's hooks. */
let appendSpy: { mockRestore: () => void } | undefined;

beforeEach(() => {
  sdk.reads = 0;
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

/** The inserted elements of one kind, in order: the SDK (`clerk.browser.js`) or the UI bundle. */
function scriptsOf(kind: "js" | "ui"): HTMLScriptElement[] {
  const marker = kind === "js" ? "data-clerk-js-script" : "data-clerk-ui-script";
  return inserted.filter((script) => script.hasAttribute(marker));
}

/** The UI constructor a real `ui.browser.js` defines. */
class FakeClerkUI {}

/** Plays a successful load of both bundles: their globals, then `load` on each element. */
function succeed(clerk: FakeClerk): void {
  globals()["Clerk"] = clerk;
  globals()["__internal_ClerkUICtor"] = FakeClerkUI;
  for (const script of [...scriptsOf("js"), ...scriptsOf("ui")]) {
    script.dispatchEvent(new Event("load"));
  }
}

/**
 * Mounts a provider with the given props inside a boundary. The boundary's fallback shows the error
 * text, so a test can wait for it. `seen` records each read of the auth state.
 */
function mount(props: Partial<ClerkProviderProps> = {}, seen: unknown[] = []) {
  const container = document.createElement("div");
  document.body.append(container);
  return render(
    () =>
      ErrorBoundary({
        fallback: (error: unknown) => {
          seen.push(error);
          return `failed:${error instanceof Error ? error.message : "?"}`;
        },
        get children() {
          return ClerkProvider({
            publishableKey: KEY,
            ...props,
            get children() {
              seen.push(useAuth());
              return "app";
            },
          });
        },
      }),
    { container },
  );
}

describe("ClerkProvider: script mode", () => {
  it("[CDN-10] inserts clerk.browser.js and ui.browser.js from the host, async, with CORS and the key on the SDK element", () => {
    mount({ scriptLoadTimeout: 60_000 });
    const [js] = scriptsOf("js");
    const [ui] = scriptsOf("ui");
    expect(js?.getAttribute("src")).toBe(CLERK_JS_URL);
    expect(js?.async).toBe(true);
    expect(js?.getAttribute("crossorigin")).toBe("anonymous");
    expect(js?.getAttribute("data-clerk-publishable-key")).toBe(KEY);
    expect(ui?.getAttribute("src")).toBe(CLERK_UI_URL);
    expect(ui?.hasAttribute("data-clerk-publishable-key")).toBe(false);
    expect(sdk.reads).toBe(0);
  });

  it("[CDN-11] the nonce is written to both script elements", () => {
    mount({ nonce: "n0nc3-value", scriptLoadTimeout: 60_000 });
    for (const script of [...scriptsOf("js"), ...scriptsOf("ui")]) {
      expect(script.getAttribute("nonce")).toBe("n0nc3-value");
    }
  });

  it("[CDN-12] the version overrides change the derived paths, and the URL overrides replace them", () => {
    mount({
      clerkJSVersion: "6.38.1",
      clerkUIVersion: "1.39.1",
      scriptLoadTimeout: 60_000,
    });
    expect(scriptsOf("js")[0]?.getAttribute("src")).toBe(
      `https://${HOST}/npm/@clerk/clerk-js@6.38.1/dist/clerk.browser.js`,
    );
    expect(scriptsOf("ui")[0]?.getAttribute("src")).toBe(
      `https://${HOST}/npm/@clerk/ui@1.39.1/dist/ui.browser.js`,
    );
    cleanup();
    inserted = [];
    mount({
      clerkJSUrl: "/assets/clerk.browser.js",
      clerkUIUrl: "https://cdn.example.org/ui.js",
      scriptLoadTimeout: 60_000,
    });
    expect(scriptsOf("js")[0]?.getAttribute("src")).toBe(
      new URL("/assets/clerk.browser.js", window.location.href).href,
    );
    expect(scriptsOf("ui")[0]?.getAttribute("src")).toBe("https://cdn.example.org/ui.js");
  });

  it("[CDN-13] a window.Clerk that already exists is used: nothing is inserted, and the provider loads it", async () => {
    const clerk = new FakeClerk();
    globals()["Clerk"] = clerk;
    globals()["__internal_ClerkUICtor"] = FakeClerkUI;
    mount();
    expect(inserted).toEqual([]);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(clerk.callsTo("load")).toHaveLength(1);
  });

  it("[CDN-14] a script element that another copy inserted is awaited, not inserted again", async () => {
    const existing = document.createElement("script");
    existing.setAttribute("data-clerk-js-script", "");
    existing.src = CLERK_JS_URL;
    // A type that is not JavaScript, so happy-dom does not fetch the test element. The real append
    // (the spy only receives what the provider inserts) puts it where the provider looks for it.
    existing.setAttribute("type", "text/x-clerk-pending");
    Element.prototype.append.call(document.head, existing);
    const clerk = new FakeClerk();
    mount();
    expect(scriptsOf("js")).toEqual([]);
    globals()["Clerk"] = clerk;
    globals()["__internal_ClerkUICtor"] = FakeClerkUI;
    existing.dispatchEvent(new Event("load"));
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(document.querySelectorAll("script[data-clerk-js-script]")).toHaveLength(1);
    existing.remove();
  });

  it("[CDN-15] after both bundles load, clerk.load gets the caller's options and the UI constructor", async () => {
    const clerk = new FakeClerk();
    mount({ loadOptions: { signInUrl: "/sign-in" }, scriptLoadTimeout: 60_000 });
    succeed(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    const [call] = clerk.callsTo("load");
    const options = call?.args[0] as { signInUrl?: string; ui?: { ClerkUI?: unknown } } | undefined;
    expect(options?.signInUrl).toBe("/sign-in");
    expect(options?.ui?.ClerkUI).toBe(FakeClerkUI);
  });

  it("[CDN-16] a script error is retried once, then the boundary shows what to check, without the key", async () => {
    const seen: unknown[] = [];
    const view = mount({ scriptLoadTimeout: 60_000 }, seen);
    scriptsOf("js")[0]?.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(scriptsOf("js")).toHaveLength(2);
    });
    scriptsOf("js")[1]?.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(view.container.textContent).toContain(
        "could not load clerk.browser.js from clerk.example.com",
      );
    });
    const text = view.container.textContent ?? "";
    expect(text).toContain("Content Security Policy");
    expect(text).toContain('mode="bundled"');
    expect(text).not.toContain(KEY);
  });

  it("[CDN-17] a script that fails once and then loads is not an error", async () => {
    const clerk = new FakeClerk();
    mount({ scriptLoadTimeout: 60_000 });
    scriptsOf("js")[0]?.dispatchEvent(new Event("error"));
    await waitFor(() => {
      expect(scriptsOf("js")).toHaveLength(2);
    });
    succeed(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
  });

  it("[CDN-18] a script that does not finish within scriptLoadTimeout is retried once, then fails with the time", async () => {
    const view = mount({ scriptLoadTimeout: 30 });
    await waitFor(() => {
      expect(view.container.textContent).toContain("did not finish loading within 30 ms");
    });
    expect(scriptsOf("js")).toHaveLength(2);
  });

  it("[CDN-19] a script that loads without defining window.Clerk fails, and says so", async () => {
    const view = mount({ scriptLoadTimeout: 60_000 });
    scriptsOf("js")[0]?.dispatchEvent(new Event("load"));
    await waitFor(() => {
      expect(scriptsOf("js")).toHaveLength(2);
    });
    scriptsOf("js")[1]?.dispatchEvent(new Event("load"));
    await waitFor(() => {
      expect(view.container.textContent).toContain("did not define its global");
    });
  });

  it("[CDN-20] unmounting while a script is pending cancels the load: no retry, no state change", async () => {
    const clerk = new FakeClerk();
    const view = mount({ scriptLoadTimeout: 60_000 });
    const before = inserted.length;
    view.unmount();
    scriptsOf("js")[0]?.dispatchEvent(new Event("error"));
    globals()["Clerk"] = clerk;
    globals()["__internal_ClerkUICtor"] = FakeClerkUI;
    scriptsOf("js")[0]?.dispatchEvent(new Event("load"));
    await waitFor(() => {
      expect(inserted.length).toBe(before);
    });
    expect(clerk.callsTo("load")).toEqual([]);
  });

  it("[CDN-21] a bundle that defines its global after unmount is not loaded into the provider", async () => {
    const clerk = new FakeClerk();
    const view = mount({ scriptLoadTimeout: 60_000 });
    view.unmount();
    succeed(clerk);
    await waitFor(() => {
      expect(globals()["Clerk"]).toBe(clerk);
    });
    expect(clerk.callsTo("load")).toEqual([]);
    expect(clerk.listeners.size).toBe(0);
  });

  it("[CDN-22] two providers around one window.Clerk call its load once", async () => {
    const clerk = new FakeClerk();
    mount({ scriptLoadTimeout: 60_000 });
    mount({ scriptLoadTimeout: 60_000 });
    succeed(clerk);
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(clerk.callsTo("load")).toHaveLength(1);
  });

  it("[CDN-27] a window.Clerk that holds another publishable key is refused, not reused", () => {
    const other = new FakeClerk() as FakeClerk & { publishableKey?: string };
    other.publishableKey = "pk_test_b3RoZXIuZXhhbXBsZS5jb20k";
    globals()["Clerk"] = other;
    globals()["__internal_ClerkUICtor"] = FakeClerkUI;
    const view = mount({ scriptLoadTimeout: 60_000 });
    return waitFor(() => {
      expect(view.container.textContent).toContain(
        "already loads Clerk with another publishable key",
      );
    }).then(() => {
      expect(view.container.textContent).not.toContain("pk_test_");
      expect(other.callsTo("load")).toEqual([]);
    });
  });

  it("[CDN-28] a window.Clerk with the same key is used as it is", async () => {
    const same = new FakeClerk() as FakeClerk & { publishableKey?: string };
    same.publishableKey = KEY;
    globals()["Clerk"] = same;
    globals()["__internal_ClerkUICtor"] = FakeClerkUI;
    mount({ scriptLoadTimeout: 60_000 });
    await waitFor(() => {
      expect(same.loaded).toBe(true);
    });
    expect(inserted).toEqual([]);
  });

  it("[CDN-23] an unknown mode is refused before any script is inserted, without echoing it", () => {
    const container = document.createElement("div");
    document.body.append(container);
    let thrown: unknown;
    try {
      render(
        () =>
          ClerkProvider({
            publishableKey: KEY,
            mode: "cdn" as unknown as ClerkProviderMode,
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
    expect(String(thrown)).toContain('mode must be "script" or "bundled"');
    expect(String(thrown)).not.toContain("cdn");
    expect(inserted).toEqual([]);
  });

  it("[CDN-24] a well-formed key that names no host fails the provider at load time, without echoing the key", async () => {
    // "nohost" in base64: the shape check passes, the decoding does not, so the loader refuses it
    // before any script is inserted.
    const badKey = "pk_test_bm9faG9zdA";
    const view = mount({ publishableKey: badKey, scriptLoadTimeout: 60_000 });
    await waitFor(() => {
      expect(view.container.textContent).toContain("does not name a Clerk frontend API");
    });
    expect(view.container.textContent).not.toContain(badKey);
    expect(inserted).toEqual([]);
  });
});
