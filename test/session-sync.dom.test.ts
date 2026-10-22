import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionSync, type SessionSync } from "../src/internal/session-sync";
import { createTabSignal } from "../src/internal/tab-signal";
import { FakeClerk, FakeSession } from "./support/fake-clerk";

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 30);
  });

const opened: Array<() => void> = [];
let channel = 0;
/** A channel name no other test uses. */
const fresh = (prefix: string): string => {
  channel += 1;
  return `${prefix}${channel}`;
};
afterEach(() => {
  for (const close of opened.splice(0)) close();
  vi.unstubAllGlobals();
});

/** One simulated tab: its own Clerk instance and controller on a shared channel name. */
function tab(name: string, onError?: (error: unknown) => void) {
  const clerk = new FakeClerk();
  clerk.loaded = true;
  const sync: SessionSync = createSessionSync({
    name,
    clerk: () => clerk,
    ...(onError === undefined ? {} : { onError }),
  });
  opened.push(() => sync.dispose());
  return { clerk, sync };
}

/** What the browser shows after the other tab signed in: the client knows the session. */
const knowsSession = (clerk: FakeClerk, id: string): void => {
  clerk.reloadEffect = () => {
    clerk.client = { lastActiveSessionId: id, signedInSessions: [{ id }] };
  };
};

describe("tab signal", () => {
  it("[TAB-01] wakes the other tabs of the channel, never the sender, and not other channels", async () => {
    const name = fresh("t");
    const a = createTabSignal(name);
    const b = createTabSignal(name);
    const other = createTabSignal(`${name}-other`);
    opened.push(
      () => a.close(),
      () => b.close(),
      () => other.close(),
    );
    const log: string[] = [];
    a.listen(() => log.push("a"));
    b.listen(() => log.push("b"));
    other.listen(() => log.push("other"));
    a.post();
    await tick();
    expect(log).toEqual(["b"]);
  });

  it("[TAB-02] falls back to the storage event where BroadcastChannel is missing", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const name = fresh("s");
    const signal = createTabSignal(name);
    opened.push(() => signal.close());
    let woken = 0;
    signal.listen(() => {
      woken += 1;
    });
    // Another tab writing the key: the browser delivers `storage` to this tab.
    window.dispatchEvent(new StorageEvent("storage", { key: `shadow-clerk-sync:${name}` }));
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(woken).toBe(1);
    signal.post();
    expect(localStorage.getItem(`shadow-clerk-sync:${name}`)).not.toBeNull();
    signal.close();
    window.dispatchEvent(new StorageEvent("storage", { key: `shadow-clerk-sync:${name}` }));
    expect(woken).toBe(1);
  });
});

describe("session sync", () => {
  it("[SYN-01] a sign-in announced by one tab makes the signed-out tab reload and adopt the session", async () => {
    const name = fresh("n");
    const a = tab(name);
    const b = tab(name);
    a.sync.observe({ session: null });
    knowsSession(b.clerk, "sess_1");
    a.sync.observe({ session: new FakeSession() });
    await tick();
    expect(b.clerk.count("__internal_reloadInitialResources")).toBe(1);
    expect(b.clerk.callsTo("setActive").map((call) => call.args[0])).toEqual([
      { session: "sess_1" },
    ]);
    // The announcing tab is not asked to reconcile its own change.
    expect(a.clerk.count("__internal_reloadInitialResources")).toBe(0);
  });

  it("[SYN-02] the first emission is the initial state and is not announced", async () => {
    const name = fresh("n");
    const a = tab(name);
    const b = tab(name);
    a.sync.observe({ session: new FakeSession() });
    await tick();
    expect(b.clerk.count("__internal_reloadInitialResources")).toBe(0);
  });

  it("[SYN-03] a change caused by reconciling is not announced again: no ping-pong between tabs", async () => {
    const name = fresh("n");
    const a = tab(name);
    const b = tab(name);
    a.sync.observe({ session: null });
    b.sync.observe({ session: null });
    // B's reload makes Clerk emit the new session to B's listeners.
    b.clerk.reloadEffect = () => {
      b.clerk.client = { lastActiveSessionId: "sess_1", signedInSessions: [{ id: "sess_1" }] };
      b.sync.observe({ session: new FakeSession() });
    };
    a.sync.observe({ session: new FakeSession() });
    await tick();
    await tick();
    expect(b.clerk.count("__internal_reloadInitialResources")).toBe(1);
    expect(a.clerk.count("__internal_reloadInitialResources")).toBe(0);
  });

  it("[SYN-04] an organization switch in one tab reaches the others", async () => {
    const name = fresh("n");
    const a = tab(name);
    const b = tab(name);
    const session = new FakeSession();
    a.sync.observe({ session, organization: { id: "org_1" } });
    b.clerk.session = session;
    b.clerk.organization = { id: "org_1" };
    b.clerk.reloadEffect = () => {
      b.clerk.client = { lastActiveSessionId: session.id, signedInSessions: [{ id: session.id }] };
      const reloaded = new FakeSession(session.id);
      reloaded.lastActiveOrganizationId = "org_2";
      b.clerk.session = reloaded;
    };
    a.sync.observe({ session, organization: { id: "org_2" } });
    await tick();
    expect(b.clerk.callsTo("setActive").map((call) => call.args[0])).toEqual([
      { organization: "org_2" },
    ]);
  });

  it("[SYN-05] wakes that arrive during a reconcile are folded into one more run, not run in parallel", async () => {
    const name = fresh("n");
    const a = tab(name);
    const b = tab(name);
    let release: (() => void) | undefined;
    let concurrent = 0;
    let peak = 0;
    b.clerk.__internal_reloadInitialResources = async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      b.clerk.calls.push({ method: "__internal_reloadInitialResources", args: [] });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      concurrent -= 1;
    };
    a.sync.observe({ session: null });
    a.sync.observe({ session: new FakeSession() });
    a.sync.observe({ session: null });
    a.sync.observe({ session: new FakeSession() });
    await tick();
    release?.();
    await tick();
    release?.();
    await tick();
    expect(peak).toBe(1);
    expect(b.clerk.count("__internal_reloadInitialResources")).toBeLessThanOrEqual(2);
    expect(b.clerk.count("__internal_reloadInitialResources")).toBeGreaterThanOrEqual(1);
  });

  it("[SYN-06] a failing reload or setActive is reported, never thrown, and the next wake still works", async () => {
    const name = fresh("n");
    const errors: unknown[] = [];
    const a = tab(name);
    const b = tab(name, (error) => errors.push(error));
    b.clerk.__internal_reloadInitialResources = () => Promise.reject(new Error("network"));
    a.sync.observe({ session: null });
    a.sync.observe({ session: new FakeSession() });
    await tick();
    expect(errors).toHaveLength(1);
    b.clerk.__internal_reloadInitialResources = () => {
      b.clerk.calls.push({ method: "__internal_reloadInitialResources", args: [] });
      b.clerk.client = { lastActiveSessionId: "s", signedInSessions: [{ id: "s" }] };
      return Promise.resolve();
    };
    a.sync.observe({ session: null });
    await tick();
    expect(b.clerk.count("__internal_reloadInitialResources")).toBe(1);
  });

  it("[SYN-07] without clerk-js's internal reload it uses the client's reload, and without either it does nothing", async () => {
    const name = fresh("n");
    const a = tab(name);
    const b = tab(name);
    let reloads = 0;
    (b.clerk as { __internal_reloadInitialResources?: unknown }).__internal_reloadInitialResources =
      undefined;
    b.clerk.client = {
      lastActiveSessionId: "sess_9",
      signedInSessions: [{ id: "sess_9" }],
      reload: () => {
        reloads += 1;
        return Promise.resolve();
      },
    };
    a.sync.observe({ session: null });
    a.sync.observe({ session: new FakeSession() });
    await tick();
    expect(reloads).toBe(1);
    expect(b.clerk.callsTo("setActive")).toHaveLength(1);
    (b.clerk.client as { reload?: unknown }).reload = undefined;
    a.sync.observe({ session: null });
    await tick();
    expect(b.clerk.callsTo("setActive")).toHaveLength(1);
  });

  it("[SYN-08] a signed-out tab that gets focus reconciles at most once per throttle window; a signed-in tab never", async () => {
    const name = fresh("n");
    let time = 0;
    const clerk = new FakeClerk();
    clerk.loaded = true;
    const sync = createSessionSync({
      name,
      clerk: () => clerk,
      focusThrottleMs: 1000,
      now: () => time,
    });
    opened.push(() => sync.dispose());
    sync.tabFocused();
    sync.tabFocused();
    await tick();
    expect(clerk.count("__internal_reloadInitialResources")).toBe(1);
    time = 1500;
    sync.tabFocused();
    await tick();
    expect(clerk.count("__internal_reloadInitialResources")).toBe(2);
    clerk.session = new FakeSession();
    time = 5000;
    sync.tabFocused();
    await tick();
    expect(clerk.count("__internal_reloadInitialResources")).toBe(2);
  });

  it("[SYN-09] after dispose nothing is announced, received or reloaded", async () => {
    const name = fresh("n");
    const a = tab(name);
    const b = tab(name);
    a.sync.observe({ session: null });
    b.sync.dispose();
    a.sync.observe({ session: new FakeSession() });
    await tick();
    expect(b.clerk.count("__internal_reloadInitialResources")).toBe(0);
    a.sync.dispose();
    a.sync.observe({ session: null });
    a.sync.tabFocused();
    await tick();
    expect(a.clerk.count("__internal_reloadInitialResources")).toBe(0);
  });

  it("[SYN-10] without an onError, a failed reload is reported to console.error in every build, never dropped", async () => {
    const name = fresh("n");
    const a = tab(name);
    const b = tab(name);
    b.clerk.__internal_reloadInitialResources = () => Promise.reject(new Error("network"));
    const reported = vi.mocked(console.error);
    reported.mockClear();
    a.sync.observe({ session: null });
    a.sync.observe({ session: new FakeSession() });
    await tick();
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported.mock.calls[0]?.[0]).toContain("[shadow clerk]");
    expect(reported.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    reported.mockClear();
  });

  it("[SYN-11] a blocked localStorage write (private mode, quota) is reported, not swallowed", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const name = fresh("q");
    const signal = createTabSignal(name);
    opened.push(() => signal.close());
    const blocked = new DOMException("The quota has been exceeded.", "QuotaExceededError");
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw blocked;
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    });
    const reported = vi.mocked(console.warn);
    reported.mockClear();
    signal.post();
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported.mock.calls[0]?.[1]).toBe(blocked);
    reported.mockClear();
  });
});
