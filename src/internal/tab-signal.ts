/**
 * A one-bit signal between the tabs of one origin: `post()` in one tab wakes the `listen` callback of
 * every OTHER tab (never the sender). It uses `BroadcastChannel`, and falls back to the `storage`
 * event (written through `localStorage`) where the channel is missing. Nothing is polled.
 * @internal
 */
export interface TabSignal {
  post(): void;
  listen(callback: () => void): () => void;
  close(): void;
}

/** A name that separates unrelated apps on one origin. */
const PREFIX = "shadow-clerk-sync:";

/**
 * Receives a write the browser refused. Without a reporter the failure goes to `console.warn`: the
 * tabs then only sync on focus, which is a degraded mode, not a failed call.
 * @internal
 */
export type TabSignalReporter = (error: unknown) => void;

const reportBlockedWrite: TabSignalReporter = (error) => {
  console.warn(
    "[shadow clerk] cross-tab sync is degraded: localStorage refused a write; tabs sync on focus only",
    error,
  );
};

/**
 * Creates the signal for one channel name.
 * @internal
 */
export function createTabSignal(
  name: string,
  reportWrite: TabSignalReporter = reportBlockedWrite,
): TabSignal {
  const channelName = `${PREFIX}${name}`;
  const hasChannel = typeof BroadcastChannel !== "undefined";
  const channel = hasChannel ? new BroadcastChannel(channelName) : undefined;
  const listeners = new Set<() => void>();

  const wake = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const onMessage = (): void => wake();
  const onStorage = (event: StorageEvent): void => {
    if (event.key === channelName) wake();
  };

  if (channel !== undefined) channel.addEventListener("message", onMessage);
  else if (typeof window !== "undefined") window.addEventListener("storage", onStorage);

  return {
    post() {
      if (channel !== undefined) {
        channel.postMessage(1);
        return;
      }
      try {
        // A new value on every write: the storage event fires only for a change, and only in other tabs.
        localStorage.setItem(channelName, `${Date.now()}.${Math.random()}`);
      } catch (error) {
        // Storage can be blocked (private mode, quota). The focus refresh still syncs the tabs, so
        // this is reported and the signal keeps working for the next write.
        reportWrite(error);
      }
    },
    listen(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    close() {
      listeners.clear();
      if (channel !== undefined) {
        channel.removeEventListener("message", onMessage);
        channel.close();
      } else if (typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
      }
    },
  };
}
