import { cleanup, flush, render } from "@shadow-js/testing/dom";
import { ErrorBoundary } from "@shadow-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClerkProvider, type ClerkProviderProps, useAuth } from "../src/index";
import { FakeClerk } from "./support/fake-clerk";

/**
 * Review round two. Script mode is driven the way script-mode.dom.test.ts does: `document.head.append` is spied on, the
 * test plays the browser.
 */

const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

afterEach(() => cleanup());

describe("ClerkProvider: a throw while the loaded state is applied", () => {
  it("[CLERK-R2-13] reaches the ErrorBoundary instead of becoming an unhandled rejection", async () => {
    const clerk = new FakeClerk();
    // A load that succeeds, then an instance whose resources cannot be read: the throw comes from applying the loaded
    // state, not from load() itself.
    clerk.load = async (): Promise<void> => {
      clerk.loaded = true;
      Object.defineProperty(clerk, "user", {
        get(): never {
          throw new Error("user read broke");
        },
      });
    };
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", record);
    try {
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
                  useAuth();
                  return "app";
                },
              });
            },
          }),
        { container },
      );
      await flush();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(container.textContent).toBe("fallback:user read broke");
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });
});

describe("script mode: a provider that goes away while another waits for the same script", () => {
  const CLERK_JS_URL = "https://clerk.example.com/npm/@clerk/clerk-js@6/dist/clerk.browser.js";
  type Globals = Record<string, unknown>;
  const globals = (): Globals => window as unknown as Globals;
  let inserted: HTMLScriptElement[] = [];

  beforeEach(() => {
    inserted = [];
    vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      for (const node of nodes) {
        if (node instanceof HTMLScriptElement) {
          inserted.push(node);
          // Not JavaScript, so happy-dom does not fetch it; the provider finds it by its marker attribute.
          node.setAttribute("type", "text/x-clerk-pending");
          Element.prototype.append.call(document.head, node);
        }
      }
    });
  });

  afterEach(() => {
    for (const script of inserted) script.remove();
    delete globals()["Clerk"];
    delete globals()["__internal_ClerkUICtor"];
  });

  function mount(props: Partial<ClerkProviderProps>): () => void {
    const container = document.createElement("div");
    document.body.append(container);
    const view = render(
      () =>
        ClerkProvider({
          publishableKey: KEY,
          mode: "script",
          scriptLoadTimeout: 60_000,
          children: "app",
          ...props,
        }),
      { container },
    );
    return () => view.unmount();
  }

  it("[CLERK-R2-15] unmounting the provider that inserted the script keeps the element the other one waits on", async () => {
    const first = mount({});
    await flush();
    const script = inserted.find((item) => item.src === CLERK_JS_URL);
    expect(script).toBeDefined();
    const second = mount({});
    await flush();
    // The second provider found the first one's element instead of inserting its own.
    expect(inserted.filter((item) => item.src === CLERK_JS_URL)).toHaveLength(1);
    first();
    await flush();
    expect(script?.isConnected).toBe(true);
    second();
    await flush();
    // Nobody waits any more: the element goes.
    expect(script?.isConnected).toBe(false);
  });
});
