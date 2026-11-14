import { cleanup, render, waitFor } from "@shadow-js/testing/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClerkProvider, useClerkUi } from "../src/index";
import { FakeClerk } from "./support/fake-clerk";

/*
 * `loadUi` in bundled mode: `@clerk/ui` is imported when the provider asks for it, not with `@clerk/clerk-js`. Like
 * the other bundled tests, the mocked modules count their reads.
 */

const sdk = vi.hoisted(() => ({ instance: undefined as object | undefined }));
vi.mock("@clerk/clerk-js", () => {
  class MockClerk {
    constructor() {
      if (sdk.instance === undefined) throw new Error("no instance configured");
      // biome-ignore lint/correctness/noConstructorReturn: the SDK's constructor hands back the instance it created; the mock does the same
      return sdk.instance;
    }
  }
  return { Clerk: MockClerk };
});

const ui = vi.hoisted(() => ({
  reads: 0,
  ClerkUI: class FakeClerkUI {},
  failure: undefined as { readonly error: unknown } | undefined,
}));
vi.mock("@clerk/ui", () => ({
  get ui() {
    ui.reads += 1;
    if (ui.failure !== undefined) throw ui.failure.error;
    return { ClerkUI: ui.ClerkUI };
  },
}));

const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

beforeEach(() => {
  ui.reads = 0;
  ui.failure = undefined;
  sdk.instance = undefined;
});
afterEach(() => cleanup());

function mount(loadUi: "eager" | "lazy" | "never") {
  const handle: { ui?: ReturnType<typeof useClerkUi> } = {};
  const container = document.createElement("div");
  document.body.append(container);
  render(
    () =>
      ClerkProvider({
        publishableKey: KEY,
        mode: "bundled",
        loadUi,
        get children() {
          handle.ui = useClerkUi();
          return "app";
        },
      }),
    { container },
  );
  return handle;
}

const uiOptionOf = (clerk: FakeClerk): unknown =>
  (clerk.callsTo("load")[0]?.args[0] as { ui?: { ClerkUI?: unknown } } | undefined)?.ui?.ClerkUI;

describe('bundled mode with loadUi="lazy"', () => {
  it("[CUI-20] @clerk/ui is not imported with the SDK; clerk.load gets a pending promise that resolves when load() ran", async () => {
    const clerk = new FakeClerk();
    sdk.instance = clerk;
    const handle = mount("lazy");
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(ui.reads).toBe(0);
    const given = uiOptionOf(clerk);
    expect(given).toBeInstanceOf(Promise);
    expect(handle.ui?.ready()).toBe(false);
    await handle.ui?.load();
    expect(ui.reads).toBe(1);
    expect(handle.ui?.ready()).toBe(true);
    expect(await given).toBe(ui.ClerkUI);
    await handle.ui?.load();
    expect(ui.reads).toBe(1);
  });

  it("[CUI-21] a missing @clerk/ui rejects load() by name, and the next call tries again", async () => {
    const clerk = new FakeClerk();
    sdk.instance = clerk;
    const handle = mount("lazy");
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    ui.failure = { error: new Error("Cannot find package '@clerk/ui'") };
    await expect(handle.ui?.load()).rejects.toThrow("@clerk/ui");
    ui.failure = undefined;
    await handle.ui?.load();
    expect(handle.ui?.ready()).toBe(true);
  });
});

describe('bundled mode with loadUi="never"', () => {
  it("[CUI-22] @clerk/ui is never imported, clerk.load gets no UI constructor, and load() rejects", async () => {
    const clerk = new FakeClerk();
    sdk.instance = clerk;
    const handle = mount("never");
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(uiOptionOf(clerk)).toBeUndefined();
    await expect(handle.ui?.load()).rejects.toThrow('loadUi="never"');
    expect(ui.reads).toBe(0);
  });
});

describe("bundled mode, the default", () => {
  it("[CUI-23] eager still imports @clerk/ui with the SDK and hands it to clerk.load", async () => {
    const clerk = new FakeClerk();
    sdk.instance = clerk;
    mount("eager");
    await waitFor(() => {
      expect(clerk.loaded).toBe(true);
    });
    expect(ui.reads).toBe(1);
    expect(uiOptionOf(clerk)).toBe(ui.ClerkUI);
  });
});
