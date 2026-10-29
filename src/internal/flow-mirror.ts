import type { ClerkFlowSnapshots, ClerkLike } from "../types";
import { readClerkState } from "./private-api";

/**
 * Keeps the provider's sign-in and sign-up state in step with clerk-js's future state.
 *
 * One subscription per loaded Clerk instance: `follow(clerk)` subscribes to the instance's state effect, and a later
 * `follow` of another instance (or of `null`, on unmount) disposes the previous subscription first. A report about a
 * clerk-js that lacks the state, or hands over an unusable resource, is written once per mirror.
 * @internal
 */
export interface FlowMirror {
  /** Follows `clerk` (after it has loaded), or stops following with `null`. Following the same instance twice does nothing. */
  follow(clerk: ClerkLike | null): void;
}

/** The flows before any Clerk state: no resource, no errors, idle. Shared, so an empty mirror is never a new object. */
export const EMPTY_FLOWS: ClerkFlowSnapshots = {
  signIn: { resource: null, errors: { fields: {}, raw: null, global: null }, fetchStatus: "idle" },
  signUp: { resource: null, errors: { fields: {}, raw: null, global: null }, fetchStatus: "idle" },
};

/** The message for a clerk-js without the future state, written once per mirror. */
const MISSING_STATE = __DEV__
  ? "@clerk/clerk-js does not expose the future sign-in and sign-up state (its private state object), so useSignIn().signIn() and useSignUp().signUp() stay null. Upgrade @clerk/clerk-js to 6.38.1 or later; the custom flow API needs it."
  : "CLERK_FUTURE_2";

/**
 * Creates a mirror that calls `mirror` with both flows on every clerk-js change.
 * @param mirror Receives each change; the provider writes it into its signals in one batch.
 * @returns The mirror. Nothing is subscribed until {@link FlowMirror.follow} is called.
 * @internal
 */
export function createFlowMirror(mirror: (flows: ClerkFlowSnapshots) => void): FlowMirror {
  let current: ClerkLike | null = null;
  let stop: (() => void) | undefined;
  let reported = false;
  const report = (message: string): void => {
    if (reported) return;
    reported = true;
    console.error(`[@shadow-js/clerk] ${message}`);
  };
  return {
    follow(clerk) {
      if (clerk === current) return;
      stop?.();
      stop = undefined;
      current = clerk;
      if (clerk === null) return;
      const reader = readClerkState(clerk);
      if (reader === null) {
        report(MISSING_STATE);
        mirror(EMPTY_FLOWS);
        return;
      }
      stop = reader.observe(mirror, report);
    },
  };
}
