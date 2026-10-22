import type { ClerkLike, ClerkResourcesLike } from "../types";
import { reloadClientResources } from "./private-api";
import { createTabSignal } from "./tab-signal";

/**
 * Keeps the tabs of one browser on the same Clerk session.
 *
 * clerk-js broadcasts only a sign-OUT to the other tabs. A sign-in, an account switch or an
 * organization switch made in one tab is not delivered to the others, and a tab without a session
 * does not refresh itself on focus, so it stays signed out until it reloads. This controller closes
 * that gap with explicit, event-driven signals and no polling:
 *
 * - when the session or organization of THIS tab changes (`observe`), it wakes the other tabs through
 *   a `BroadcastChannel` (`storage` event as the fallback);
 * - a tab that is woken (or that is signed out and gets focus) reloads its client from Clerk and
 *   makes the right session and organization active, then lets the normal Clerk listeners update the
 *   signals. Changes caused by that reconcile are not announced again, so tabs never ping-pong.
 *
 * It uses the narrow `ClerkLike` surface and, for the reload, the guarded adapter in `./private-api`
 * (clerk-js's internal reload, else the client's public `reload`): where neither exists the controller
 * does nothing.
 * @internal
 */
export interface SessionSync {
  /** Reports the resources Clerk emitted; announces a session or organization change to other tabs. */
  observe(resources: ClerkResourcesLike): void;
  /** The tab became visible or focused: a signed-out tab reconciles (throttled). */
  tabFocused(): void;
  /** Stops listening and closes the channel. */
  dispose(): void;
}

/**
 * Options of {@link createSessionSync}.
 * @internal
 */
export interface SessionSyncOptions {
  /** Channel name (one per publishable key). */
  readonly name: string;
  /** The Clerk instance, once it exists. */
  readonly clerk: () => ClerkLike | undefined;
  /**
   * Receives failures of the reload, of `setActive` or of a refused write to storage. Default:
   * `console.error`, in every build. A background sync failure must never be dropped silently.
   */
  readonly onError?: (error: unknown) => void;
  /** Minimum milliseconds between focus-triggered reconciles. Default 2000. */
  readonly focusThrottleMs?: number;
  /** Time source in milliseconds. Default `Date.now`. */
  readonly now?: () => number;
}

/**
 * Creates the controller. Call `dispose()` with the owner that created it.
 * @internal
 */
export function createSessionSync(options: SessionSyncOptions): SessionSync {
  const signal = createTabSignal(options.name, (error) => report(error));
  const now = options.now ?? Date.now;
  const throttle = options.focusThrottleMs ?? 2000;
  let key: string | undefined;
  let remote = 0;
  let lastFocus = Number.NEGATIVE_INFINITY;
  let running: Promise<void> | undefined;
  let again = false;
  let disposed = false;

  const report = (error: unknown): void => {
    if (options.onError !== undefined) options.onError(error);
    else console.error("[shadow clerk] syncing the session with other tabs failed", error);
  };

  /** The session clerk-js would pick at load: the last active one, else the first signed-in one. */
  const wantedSession = (clerk: ClerkLike): string | undefined => {
    const sessions = clerk.client?.signedInSessions ?? [];
    const last = clerk.client?.lastActiveSessionId;
    return (sessions.find((item) => item.id === last) ?? sessions[0])?.id;
  };

  const adopt = async (clerk: ClerkLike): Promise<void> => {
    const wanted = wantedSession(clerk);
    if (wanted !== undefined && clerk.session?.id !== wanted) {
      await clerk.setActive({ session: wanted });
      return;
    }
    // Same session, other organization: follow the organization the session was last used with.
    const organization = clerk.session?.lastActiveOrganizationId;
    if (
      organization !== undefined &&
      organization !== null &&
      clerk.organization?.id !== organization
    ) {
      await clerk.setActive({ organization });
    }
  };

  const reload = (clerk: ClerkLike): Promise<boolean> => reloadClientResources(clerk);

  /** One reconcile at a time; a request that arrives meanwhile runs once more afterward. */
  const reconcile = (): Promise<void> => {
    if (running !== undefined) {
      again = true;
      return running;
    }
    const run = async (): Promise<void> => {
      do {
        again = false;
        const clerk = options.clerk();
        if (disposed || clerk === undefined || !clerk.loaded) return;
        remote += 1;
        try {
          if (await reload(clerk)) await adopt(clerk);
        } catch (error) {
          report(error);
        } finally {
          remote -= 1;
        }
      } while (again && !disposed);
    };
    running = run().finally(() => {
      running = undefined;
    });
    return running;
  };

  const stopListening = signal.listen(() => {
    void reconcile();
  });

  return {
    observe(resources) {
      const next = `${resources.session?.id ?? ""}|${resources.organization?.id ?? ""}`;
      const first = key === undefined;
      const changed = key !== next;
      key = next;
      // The first emission is the initial state, and a change made by our own reconcile came from
      // another tab: neither is announced.
      if (!first && changed && remote === 0 && !disposed) signal.post();
    },
    tabFocused() {
      const clerk = options.clerk();
      if (disposed || clerk === undefined || !clerk.loaded) return;
      if (clerk.session?.status === "active") return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const time = now();
      if (time - lastFocus < throttle) return;
      lastFocus = time;
      void reconcile();
    },
    dispose() {
      disposed = true;
      stopListening();
      signal.close();
    },
  };
}
