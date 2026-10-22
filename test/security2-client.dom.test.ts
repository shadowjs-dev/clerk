import { cleanup, flush, render } from "@shadow-js/testing/dom";
import { ErrorBoundary } from "@shadow-js/web";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandleSSOCallback } from "../src/components/sso-callback";
import { ClerkProvider } from "../src/index";
import { clerkJSScriptUrl, frontendApiOf, loadClerkScripts } from "../src/internal/script";
import { createSessionSync } from "../src/internal/session-sync";
import { createTabSignal } from "../src/internal/tab-signal";
import { FakeClerk, FakeSession } from "./support/fake-clerk";

/**
 * PASS 2, scope A (Clerk), the browser side: the script loader, the SSO callback and the cross-tab signal.
 */

const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
const HOST = "clerk.example.com";

function keyFor(host: string): string {
  return `pk_live_${Buffer.from(`${host}$`).toString("base64")}`;
}

type Globals = Record<string, unknown>;
const globals = (): Globals => window as unknown as Globals;

/** Every script element the loader tried to insert; happy-dom would fetch them for real otherwise. */
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
  vi.unstubAllGlobals();
});

/**
 * Starts a load with the given overrides and returns the error it rejected with. A URL that was accepted leaves the
 * load waiting for its scripts, so the test aborts it: that rejection ("unmounted") reads as no error.
 */
async function loadError(overrides: Record<string, string | undefined>): Promise<unknown> {
  const controller = new AbortController();
  const outcome = loadClerkScripts({
    publishableKey: KEY,
    timeoutMs: 60_000,
    signal: controller.signal,
    ...overrides,
  }).then(
    () => undefined,
    (error: unknown) => error,
  );
  controller.abort();
  const error = await outcome;
  return error instanceof Error && /unmounted/.test(error.message) ? undefined : error;
}

describe("SEC2-CLERK-8x the script loader", () => {
  it.each([
    ["a port", "clerk.example.com:8443"],
    ["a path", "clerk.example.com/evil"],
    ["a query", "clerk.example.com?x=1"],
    ["a fragment", "clerk.example.com#x"],
    ["userinfo", "user@clerk.example.com"],
    ["a backslash", "clerk.example.com\\evil.example"],
    ["a space", "clerk.example.com evil.example"],
    ["a scheme", "https://clerk.example.com"],
    ["a non-ASCII letter (homograph)", "clеrk.example.com"],
    ["a trailing dot", "clerk.example.com."],
    ["an empty label", "clerk..example.com"],
    ["an IPv4 address", "169.254.169.254"],
    ["a short IPv4 address", "127.1"],
    ["a hexadecimal IPv4 address", "0x7f.1"],
    ["no dot", "localhost"],
    ["nothing", ""],
  ])("[SEC2-CLERK-80] a publishable key naming %s is refused", (_name, host) => {
    expect(() => frontendApiOf(keyFor(host))).toThrow(/does not name a Clerk frontend API/);
  });

  it("[SEC2-CLERK-81] fuzz: whatever host a key names, the derived URL is https on exactly that host, with no port, path trick or credentials", () => {
    const label = fc.string({ unit: fc.constantFrom(..."abcxyz019-"), minLength: 1, maxLength: 8 });
    const noise = fc.string({ unit: fc.constantFrom(..."aZ9-.:/@?#\\ %е$"), maxLength: 24 });
    let accepted = 0;
    fc.assert(
      fc.property(
        fc.oneof(
          fc.array(label, { minLength: 1, maxLength: 4 }).map((labels) => labels.join(".")),
          noise,
        ),
        (host) => {
          let resolved: string;
          try {
            resolved = frontendApiOf(keyFor(host));
          } catch (error) {
            expect(error).toBeInstanceOf(TypeError);
            return;
          }
          accepted += 1;
          const url = new URL(clerkJSScriptUrl(resolved, {}));
          expect(url.protocol).toBe("https:");
          expect(url.hostname).toBe(resolved.toLowerCase());
          expect(url.port).toBe("");
          expect(url.username).toBe("");
          expect(url.password).toBe("");
          expect(url.pathname.startsWith("/npm/@clerk/clerk-js@")).toBe(true);
        },
      ),
      { seed: 20261010, numRuns: 400 },
    );
    expect(accepted).toBeGreaterThan(20);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/javascript,alert(1)"],
    ["blob:", "blob:https://clerk.example.com/1"],
    ["file:", "file:///etc/passwd"],
    ["ftp:", "ftp://clerk.example.com/clerk.js"],
    ["a plain-http foreign host", "http://evil.example/clerk.browser.js"],
    [
      "a protocol-relative URL on an http page (it resolves to plain http)",
      "//evil.example/clerk.browser.js",
    ],
    ["a name that only starts like localhost", "http://localhost.evil.example/clerk.browser.js"],
    ["a name that only ends like localhost", "http://evil-localhost/clerk.browser.js"],
    ["not a URL", "http://"],
  ])(
    "[SEC2-CLERK-82] clerkJSUrl set to %s is refused, and nothing is inserted",
    async (_name, clerkJSUrl) => {
      const error = await loadError({ clerkJSUrl });
      expect(error).toBeInstanceOf(TypeError);
      expect(String((error as Error).message)).toMatch(/clerkJSUrl/);
      expect(inserted).toEqual([]);
    },
  );

  it("[SEC2-CLERK-83] a bad clerkUIUrl is refused before clerk.browser.js is inserted", async () => {
    const error = await loadError({ clerkUIUrl: "javascript:alert(1)" });
    expect(error).toBeInstanceOf(TypeError);
    expect(String((error as Error).message)).toMatch(/clerkUIUrl/);
    expect(inserted).toEqual([]);
  });

  it.each([
    ["an https URL", "https://cdn.example.org/clerk.browser.js"],
    ["a page-relative path", "/assets/clerk.browser.js"],
    ["plain http to localhost", "http://localhost:5173/clerk.browser.js"],
    ["plain http to 127.0.0.1", "http://127.0.0.1:5173/clerk.browser.js"],
    ["plain http to ::1", "http://[::1]:5173/clerk.browser.js"],
    ["plain http to a .localhost name", "http://app.localhost:3000/clerk.browser.js"],
  ])("[SEC2-CLERK-84] clerkJSUrl set to %s is inserted as written", async (_name, clerkJSUrl) => {
    const controller = new AbortController();
    const pending = loadClerkScripts({
      publishableKey: KEY,
      clerkJSUrl,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    const script = inserted.find((item) => item.hasAttribute("data-clerk-js-script"));
    expect(script?.getAttribute("src")).toBe(new URL(clerkJSUrl, window.location.href).href);
    controller.abort();
    await expect(pending).rejects.toThrow(/unmounted/);
  });

  it("[SEC2-CLERK-85] the derived URLs are https on the key's host whatever the version overrides say, and a version cannot change the path", async () => {
    for (const version of [
      "6/../evil",
      "6?x=1",
      "6#x",
      "6 7",
      "6\\7",
      "",
      "../..",
      "6;x",
      "a".repeat(65),
    ]) {
      expect(() => clerkJSScriptUrl(HOST, { clerkJSVersion: version }), version).toThrow(TypeError);
    }
    const url = new URL(clerkJSScriptUrl(HOST, { clerkJSVersion: "6.38.1" }));
    expect(url.origin).toBe(`https://${HOST}`);
    expect(url.pathname).toBe("/npm/@clerk/clerk-js@6.38.1/dist/clerk.browser.js");
  });

  it("[SEC2-CLERK-86] the nonce is written as an attribute value only, whatever characters it has, and an empty one is not written", async () => {
    const hostile = "\"><img src=x onerror=alert(1)> '";
    const controller = new AbortController();
    const pending = loadClerkScripts({
      publishableKey: KEY,
      nonce: hostile,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    const scripts = inserted.filter(
      (item) =>
        item.hasAttribute("data-clerk-js-script") || item.hasAttribute("data-clerk-ui-script"),
    );
    expect(scripts).toHaveLength(2);
    for (const script of scripts) {
      expect(script.getAttribute("nonce")).toBe(hostile);
      expect([...script.attributes].map((attribute) => attribute.name).sort()).toEqual(
        script.hasAttribute("data-clerk-js-script")
          ? [
              "async",
              "crossorigin",
              "data-clerk-js-script",
              "data-clerk-publishable-key",
              "nonce",
              "src",
            ]
          : ["async", "crossorigin", "data-clerk-ui-script", "nonce", "src"],
      );
      expect(script.querySelector("img")).toBeNull();
    }
    controller.abort();
    await expect(pending).rejects.toThrow(/unmounted/);
    inserted = [];
    document
      .querySelectorAll("script[data-clerk-js-script], script[data-clerk-ui-script]")
      .forEach((node) => {
        node.remove();
      });
    const second = new AbortController();
    const empty = loadClerkScripts({
      publishableKey: KEY,
      nonce: "",
      timeoutMs: 60_000,
      signal: second.signal,
    });
    expect(inserted.every((script) => !script.hasAttribute("nonce"))).toBe(true);
    second.abort();
    await expect(empty).rejects.toThrow(/unmounted/);
  });

  it("[SEC2-CLERK-87] the elements ask for CORS without credentials and carry no integrity attribute: script mode loads a floating major version", async () => {
    const controller = new AbortController();
    const pending = loadClerkScripts({
      publishableKey: KEY,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    for (const script of inserted) {
      expect(script.getAttribute("crossorigin")).toBe("anonymous");
      expect(script.hasAttribute("integrity")).toBe(false);
      expect(script.async).toBe(true);
    }
    controller.abort();
    await expect(pending).rejects.toThrow(/unmounted/);
  });
});

describe("SEC2-CLERK-8x HandleSSOCallback destinations", () => {
  /** Mounts the callback in a provider inside a boundary; returns what happened. */
  async function run(
    props: Record<string, unknown>,
    attempts: { signIn: unknown; signUp: unknown } = {
      signIn: { status: "complete", createdSessionId: "sess_1" },
      signUp: { status: null },
    },
  ) {
    class AttemptsClerk extends FakeClerk {
      override emit(): void {
        if (this.loaded)
          this.client = { signIn: attempts.signIn, signUp: attempts.signUp } as never;
        super.emit();
      }
    }
    const clerk = new AttemptsClerk();
    const errors: unknown[] = [];
    render(() =>
      ErrorBoundary({
        fallback: (error: unknown) => {
          errors.push(error);
          return "failed";
        },
        get children() {
          return ClerkProvider({
            publishableKey: KEY,
            clerk,
            get children() {
              HandleSSOCallback(props);
              return "app";
            },
          });
        },
      }),
    );
    await flush();
    await flush();
    await flush();
    return { clerk, errors };
  }

  it("[SEC2-CLERK-88] a redirect_url in the page URL does not choose the destination", async () => {
    window.history.replaceState(
      null,
      "",
      "/sso-callback?redirect_url=https%3A%2F%2Fevil.example%2F&__clerk_redirect_url=javascript%3Aalert(1)",
    );
    const visited: string[] = [];
    const { errors } = await run({
      afterSignInUrl: "/dashboard",
      navigate: (to: string) => visited.push(to),
    });
    expect(visited).toEqual(["/dashboard"]);
    expect(errors).toEqual([]);
    window.history.replaceState(null, "", "/");
  });

  it.each([
    ["a javascript: URL", "javascript:alert(document.cookie)"],
    ["a data: URL", "data:text/html,<script>alert(1)</script>"],
    ["a vbscript: URL", "vbscript:msgbox(1)"],
    ["another origin", "https://evil.example/after"],
    ["a protocol-relative URL", "//evil.example/after"],
    ["a backslash that the URL parser reads as a slash", "/\\evil.example/after"],
    ["a tab inside the slashes", "/\t/evil.example/after"],
    ["userinfo that makes the host look like ours", "https://localhost@evil.example/after"],
  ])(
    "[SEC2-CLERK-89] with the default navigation, afterSignInUrl set to %s fails the callback before anyone is signed in",
    async (_name, afterSignInUrl) => {
      const replace = vi.fn();
      vi.spyOn(window.location, "replace").mockImplementation(replace);
      const { clerk, errors } = await run({ afterSignInUrl });
      expect(errors).toHaveLength(1);
      expect(String(errors[0])).toMatch(/origin/);
      expect(clerk.count("setActive")).toBe(0);
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it("[SEC2-CLERK-90] with the default navigation, a same-origin destination is followed, resolved against the page", async () => {
    const replace = vi.fn();
    vi.spyOn(window.location, "replace").mockImplementation(replace);
    const { clerk, errors } = await run({ afterSignInUrl: "/dashboard?tab=1" });
    expect(errors).toEqual([]);
    expect(clerk.count("setActive")).toBe(1);
    expect(replace).toHaveBeenCalledWith(new URL("/dashboard?tab=1", window.location.href).href);
  });

  it("[SEC2-CLERK-91] every route is checked, not only the one this outcome uses", async () => {
    const replace = vi.fn();
    vi.spyOn(window.location, "replace").mockImplementation(replace);
    const { clerk, errors } = await run({
      afterSignInUrl: "/ok",
      signUpUrl: "javascript:alert(1)",
    });
    expect(errors).toHaveLength(1);
    expect(clerk.count("setActive")).toBe(0);
    expect(replace).not.toHaveBeenCalled();
  });

  it("[SEC2-CLERK-92] a navigate prop takes any destination as the caller's own router decides (it is the caller's code)", async () => {
    const visited: string[] = [];
    const { errors } = await run({
      afterSignInUrl: "https://other.example/after",
      navigate: (to: string) => visited.push(to),
    });
    expect(errors).toEqual([]);
    expect(visited).toEqual(["https://other.example/after"]);
  });
});

/** A BroadcastChannel that delivers to the other channels of the same name, synchronously. */
class FakeChannel extends EventTarget {
  static readonly open = new Map<string, Set<FakeChannel>>();
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
    const set = FakeChannel.open.get(name) ?? new Set<FakeChannel>();
    set.add(this);
    FakeChannel.open.set(name, set);
  }
  postMessage(data: unknown): void {
    for (const other of FakeChannel.open.get(this.name) ?? []) {
      if (other !== this) other.deliver(data);
    }
  }
  /** What an attacker's script on the same origin can send: any structured-clone value. */
  deliver(data: unknown): void {
    const event = new Event("message");
    Object.defineProperty(event, "data", { value: data });
    this.dispatchEvent(event);
  }
  close(): void {
    FakeChannel.open.get(this.name)?.delete(this);
  }
}

describe("SEC2-CLERK-9x the cross-tab signal", () => {
  beforeEach(() => {
    FakeChannel.open.clear();
    vi.stubGlobal("BroadcastChannel", FakeChannel);
  });

  const hostile = (): unknown[] => [
    JSON.parse('{"__proto__":{"polluted":"yes"}}'),
    JSON.parse('{"constructor":{"prototype":{"polluted":"yes"}}}'),
    { type: "session", sessionId: "sess_evil", orgId: "org_evil" },
    "sess_evil",
    "x".repeat(1_000_000),
    null,
    undefined,
    7,
    [1, 2, 3],
    new Uint8Array([1, 2, 3]),
    { toString: () => "boom" },
  ];

  it("[SEC2-CLERK-93] a message of any shape only wakes the tab; nothing in it is read, and no prototype changes", () => {
    const signal = createTabSignal("sec2-93");
    let woken = 0;
    signal.listen(() => {
      woken += 1;
    });
    const attacker = new FakeChannel("shadow-clerk-sync:sec2-93");
    for (const data of hostile()) attacker.postMessage(data);
    expect(woken).toBe(hostile().length);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    signal.close();
  });

  it("[SEC2-CLERK-94] the session is never taken from a message: the tab reloads its client from Clerk and follows Clerk's answer", async () => {
    const clerk = new FakeClerk();
    clerk.loaded = true;
    clerk.client = { lastActiveSessionId: "sess_real", signedInSessions: [{ id: "sess_real" }] };
    const errors: unknown[] = [];
    const sync = createSessionSync({
      name: "sec2-94",
      clerk: () => clerk,
      onError: (error) => errors.push(error),
    });
    const attacker = new FakeChannel("shadow-clerk-sync:sec2-94");
    for (const data of hostile()) attacker.postMessage(data);
    await flush();
    await flush();
    const activated = clerk.callsTo("setActive").map((call) => JSON.stringify(call.args[0]));
    expect(activated.every((call) => call === '{"session":"sess_real"}')).toBe(true);
    expect(activated.join(" ")).not.toContain("evil");
    expect(errors).toEqual([]);
    sync.dispose();
  });

  it("[SEC2-CLERK-95] a flood of messages costs at most one reload running and one queued", async () => {
    const clerk = new FakeClerk();
    clerk.loaded = true;
    clerk.session = new FakeSession("sess_1");
    clerk.client = { lastActiveSessionId: "sess_1", signedInSessions: [{ id: "sess_1" }] };
    let reloads = 0;
    let release: () => void = () => undefined;
    clerk.__internal_reloadInitialResources = () => {
      reloads += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const sync = createSessionSync({
      name: "sec2-95",
      clerk: () => clerk,
      onError: () => undefined,
    });
    const attacker = new FakeChannel("shadow-clerk-sync:sec2-95");
    for (let i = 0; i < 5000; i += 1) attacker.postMessage(i);
    expect(reloads).toBe(1);
    release();
    await flush();
    await flush();
    expect(reloads).toBe(2);
    release();
    await flush();
    await flush();
    expect(reloads).toBe(2);
    sync.dispose();
  });

  it("[SEC2-CLERK-96] the signal registers no window message listener: there is no postMessage trust surface", () => {
    const added: string[] = [];
    const real = window.addEventListener.bind(window);
    const spy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type: string, ...rest: unknown[]) => {
        added.push(type);
        (real as (...args: unknown[]) => void)(type, ...rest);
      });
    const signal = createTabSignal("sec2-96");
    const clerk = new FakeClerk();
    const sync = createSessionSync({
      name: "sec2-96b",
      clerk: () => clerk,
      onError: () => undefined,
    });
    signal.close();
    sync.dispose();
    spy.mockRestore();
    expect(added).not.toContain("message");
  });

  it("[SEC2-CLERK-97] without BroadcastChannel the storage event wakes the tab only for its own key", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const signal = createTabSignal("sec2-97");
    let woken = 0;
    signal.listen(() => {
      woken += 1;
    });
    const fire = (key: string | null): void => {
      const event = new Event("storage");
      Object.defineProperty(event, "key", { value: key });
      window.dispatchEvent(event);
    };
    fire("something-else");
    fire(null);
    fire("shadow-clerk-sync:sec2-97-other");
    expect(woken).toBe(0);
    fire("shadow-clerk-sync:sec2-97");
    expect(woken).toBe(1);
    signal.close();
    fire("shadow-clerk-sync:sec2-97");
    expect(woken).toBe(1);
  });
});
