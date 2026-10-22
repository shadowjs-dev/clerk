/**
 * The only module of this package that names clerk-js members called `__internal_*`.
 *
 * clerk-js does not promise those members to anyone outside Clerk, so a minor release may rename or
 * remove them. Each one is therefore:
 * - read through a type guard (`typeof ... === "function"`), so a missing or changed member is a
 *   branch, never a thrown `TypeError`;
 * - paired with a documented fallback or a documented error;
 * - covered by tests that run both branches, plus a guard test that fails if any other source file
 *   names an `__internal_` member.
 *
 * Nothing else in the package may name these members.
 * @internal
 */
import type {
  ClerkErrorLike,
  ClerkFetchStatus,
  ClerkFlowErrors,
  ClerkFlowSnapshot,
  ClerkFlowSnapshots,
  ClerkLike,
  ClerkReverificationProps,
  ClerkSignInFuture,
  ClerkSignUpFuture,
} from "../types";

/** A function, as far as this module knows: it is called with `Reflect.apply`, never with a guessed `this`. */
type Callable = (...args: unknown[]) => unknown;

/** True for a value of any type that is a function. */
function isCallable(value: unknown): value is Callable {
  return typeof value === "function";
}

/** True for a non-null object (an instance, a record or an array). */
function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * `target[name]` for an object, `undefined` for anything else. `Reflect.get` keeps a getter's receiver right, and a
 * missing member reads as `undefined` instead of throwing.
 */
function memberOf(target: unknown, name: string): unknown {
  return isObject(target) ? Reflect.get(target, name) : undefined;
}

/** Calls a guarded member with `this` bound to its owner, so a method of clerk-js keeps its state. */
function invoke(owner: object, member: Callable, args: readonly unknown[]): unknown {
  return Reflect.apply(member, owner, args);
}

/**
 * Reloads the client's resources from Clerk's frontend API, through the best available member.
 *
 * Order: clerk-js's `__internal_reloadInitialResources`, then the public `client.reload()` of a
 * client that has one. The reload is what lets a tab that has no session learn about a sign-in made
 * in another tab.
 * @param clerk The Clerk instance.
 * @returns `true` when a reload was started and awaited, `false` when neither member exists.
 * @throws Whatever the reload rejects with: a failed reload is never swallowed here.
 * @internal
 */
export async function reloadClientResources(clerk: ClerkLike): Promise<boolean> {
  const internal = memberOf(clerk, "__internal_reloadInitialResources");
  if (isCallable(internal)) {
    await invoke(clerk, internal, []);
    return true;
  }
  const reload = memberOf(clerk.client, "reload");
  if (isCallable(reload) && clerk.client !== undefined) {
    await invoke(clerk.client, reload, []);
    return true;
  }
  return false;
}

/**
 * Opens clerk-js's verification dialog, if this Clerk instance has one.
 *
 * There is no public fallback: the public SDK has no call that asks for a fresh verification. When
 * the member is missing the caller must fail with an explicit error (see `useReverification`), not
 * run the action without verification.
 * @param clerk The Clerk instance, or `null` before it has loaded.
 * @param props The level to verify at and the two outcomes.
 * @returns `true` when the dialog was requested, `false` when this instance has no dialog.
 * @internal
 */
export function openVerificationDialog(
  clerk: ClerkLike | null,
  props: ClerkReverificationProps,
): boolean {
  if (clerk === null) return false;
  const open = memberOf(clerk, "__internal_openReverification");
  if (!isCallable(open)) return false;
  invoke(clerk, open, [props]);
  return true;
}

/**
 * Subscribes to clerk-js's future sign-in and sign-up state, and reports each change.
 *
 * clerk-js keeps the state in `clerk.__internal_state`: two signals (`signInSignal`, `signUpSignal`, each a function that
 * returns `{ errors, fetchStatus, signIn | signUp }`) and an effect that runs a callback now and after every change of
 * the signals it reads. Each member is type-guarded, so a clerk-js without them yields `null` (see
 * {@link readClerkState}); nothing is read from the legacy `client.signIn` resource instead.
 * @internal
 */
export interface ClerkStateReader {
  /**
   * Calls `listener` now and after every change of the sign-in or sign-up state, and returns the function that ends the
   * subscription (the effect's own dispose). `problem` is called with a message when clerk-js hands over a resource this
   * package cannot use; the resource is then reported as `null`.
   */
  observe(
    listener: (flows: ClerkFlowSnapshots) => void,
    problem: (message: string) => void,
  ): () => void;
}

/** The methods a sign-in future must have to be handed out (`reset` and `sso` are the ones this package documents). */
const SIGN_IN_METHODS: readonly string[] = ["create", "password", "sso", "reset", "finalize"];
/** The methods a sign-up future must have to be handed out. */
const SIGN_UP_METHODS: readonly string[] = [
  "create",
  "update",
  "password",
  "sso",
  "reset",
  "finalize",
];

/** True when the value has every method of a future resource this package uses. */
function hasMethods(value: unknown, methods: readonly string[]): boolean {
  return isObject(value) && methods.every((name) => isCallable(Reflect.get(value, name)));
}

/** A sign-in future, as far as this package hands it out. */
function isSignInFuture(value: unknown): value is ClerkSignInFuture {
  return hasMethods(value, SIGN_IN_METHODS) && isObject(memberOf(value, "emailCode"));
}

/** A sign-up future, as far as this package hands it out. */
function isSignUpFuture(value: unknown): value is ClerkSignUpFuture {
  return hasMethods(value, SIGN_UP_METHODS) && isObject(memberOf(value, "verifications"));
}

/** The errors of a signal value, with the fields clerk-js always sends. Anything else reads as no error. */
function errorsOf(value: unknown): ClerkFlowErrors {
  const fields = memberOf(value, "fields");
  const raw = memberOf(value, "raw");
  const global = memberOf(value, "global");
  return {
    // The record's values are checked where they are shown (a `null` or an error object); clerk-js builds this object.
    fields: isObject(fields) && !Array.isArray(fields) ? (fields as ClerkFlowErrors["fields"]) : {},
    raw: Array.isArray(raw) ? raw : null,
    global: Array.isArray(global) ? (global as readonly ClerkErrorLike[]) : null,
  };
}

/** The fetch status of a signal value: `fetching` only when clerk-js says so. */
function fetchStatusOf(value: unknown): ClerkFetchStatus {
  return memberOf(value, "fetchStatus") === "fetching" ? "fetching" : "idle";
}

/** One flow of a signal value, with its resource checked by `guard`. */
function flowOf<R>(
  value: unknown,
  key: "signIn" | "signUp",
  guard: (resource: unknown) => resource is R,
  problem: (message: string) => void,
): ClerkFlowSnapshot<R> {
  const resource = memberOf(value, key);
  let checked: R | null = null;
  if (resource !== null && resource !== undefined) {
    if (guard(resource)) checked = resource;
    else
      problem(
        `clerk-js handed over a ${key} resource without the future methods this package uses. The ${key} is null. Upgrade @clerk/clerk-js to a release with the future custom-flow API (6.38.1 or later is what this package is tested with).`,
      );
  }
  return {
    resource: checked,
    errors: errorsOf(memberOf(value, "errors")),
    fetchStatus: fetchStatusOf(value),
  };
}

/**
 * Reads clerk-js's future sign-in and sign-up state through its internal signals.
 *
 * @param clerk The Clerk instance. Read after the SDK has loaded.
 * @returns A reader, or `null` when the instance lacks `__internal_state` or one of its three members (`signInSignal`,
 *   `signUpSignal`, `__internal_effect`). The caller then reports that the clerk-js version is too old and keeps the
 *   flows empty. There is deliberately no fallback to the legacy `client.signIn` resource: it has no `reset()` and no
 *   `sso()`, so handing it out as the future resource would fail at the first call.
 * @internal
 */
export function readClerkState(clerk: ClerkLike): ClerkStateReader | null {
  const state = memberOf(clerk, "__internal_state");
  if (!isObject(state)) return null;
  const signInSignal = memberOf(state, "signInSignal");
  const signUpSignal = memberOf(state, "signUpSignal");
  const effect = memberOf(state, "__internal_effect");
  if (!isCallable(signInSignal) || !isCallable(signUpSignal) || !isCallable(effect)) return null;
  return {
    observe(listener, problem) {
      const dispose = invoke(state, effect, [
        () => {
          const signIn = invoke(state, signInSignal, []);
          const signUp = invoke(state, signUpSignal, []);
          listener({
            signIn: flowOf(signIn, "signIn", isSignInFuture, problem),
            signUp: flowOf(signUp, "signUp", isSignUpFuture, problem),
          });
        },
      ]);
      return isCallable(dispose) ? () => void invoke(state, dispose, []) : () => undefined;
    },
  };
}

/**
 * The UI constructor that the `ui.browser.js` of script mode defines on `window`, or `undefined` before
 * it has loaded. `clerk.load({ ui: { ClerkUI } })` takes it. Read here, as a global, so the name of the
 * member is in one module only.
 * @internal
 */
export function scriptClerkUI(): unknown {
  return (window as unknown as Readonly<Record<string, unknown>>)["__internal_ClerkUICtor"];
}
