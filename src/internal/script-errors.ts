/**
 * The text of a failed Clerk script load. `script.ts` imports this module only when an attempt fails
 * (`import()`), so a page whose scripts load carries none of these strings. The words are the same
 * as before the split; the tests assert on them through the error boundary.
 * @packageDocumentation
 */

/** Why one script attempt failed. */
export type ScriptFailure = "loadFailed" | "timeout" | "missingGlobal" | "canceled";

/** What a failure message names: the script, its frontend API host and the timeout in use. */
export interface ScriptFailureContext {
  readonly label: string;
  readonly host: string;
  readonly timeoutMs: number;
}

/** Points at the three ways a script load goes wrong in a browser: policy, network or blocking extension. */
const HINT =
  "A Content Security Policy must allow the host in script-src (and in connect-src and img-src for Clerk's API and images). " +
  "An ad blocker or privacy extension may block it. Check the network. " +
  'The Clerk guide describes both "Loading modes" and "Content Security Policy"; <ClerkProvider mode="bundled"> loads Clerk from your own bundle instead.';

/**
 * The error a failed attempt rejects with.
 * @internal
 */
export function scriptFailure(kind: ScriptFailure, context: ScriptFailureContext): Error {
  const { label, host, timeoutMs } = context;
  switch (kind) {
    case "loadFailed":
      return new Error(`Clerk could not load ${label} from ${host}. ${HINT}`);
    case "timeout":
      return new Error(
        `Clerk's ${label} from ${host} did not finish loading within ${timeoutMs} ms. ${HINT}`,
      );
    case "missingGlobal":
      return new Error(
        `${label} from ${host} loaded but did not define its global. The URL is not Clerk's bundle, or a policy replaced it.`,
      );
    case "canceled":
      return new Error("Clerk's scripts were not loaded: the provider was unmounted.");
  }
}

/**
 * The error of a page that already loads Clerk with another key (script mode allows one key per page).
 * @internal
 */
export function otherKeyError(): TypeError {
  return new TypeError(
    'ClerkProvider: this page already loads Clerk with another publishable key. Script mode allows one key per page; use mode="bundled" for several keys.',
  );
}

/**
 * The error of `bundled` mode when `@clerk/ui` cannot be imported. The package is named, the cause is kept.
 * @internal
 */
export function uiPackageError(cause: unknown): Error {
  return new Error(
    "@shadow-js/clerk renders Clerk's components with @clerk/ui: install it next to @clerk/clerk-js (npm install @clerk/ui).",
    { cause },
  );
}

/**
 * The error of a script load that finished without defining `window.Clerk`.
 * @internal
 */
export function missingGlobalError(): Error {
  return new Error("Clerk's script did not define window.Clerk.");
}
