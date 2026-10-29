import { type Accessor, untrack, useMemo } from "@shadow-js/core";
import { requireContext } from "./internal/context";
import { openVerificationDialog } from "./internal/private-api";
import type {
  ClerkFetchStatus,
  ClerkFlowErrors,
  ClerkLike,
  ClerkMembershipLike,
  ClerkOrganizationLike,
  ClerkReverificationProps,
  ClerkSessionLike,
  ClerkSignInFuture,
  ClerkSignOutOptions,
  ClerkSignUpFuture,
  ClerkTokenOptions,
  ClerkUserLike,
} from "./types";

/**
 * Returned by {@link useAuth}. Every state field is an accessor, so reading it inside an effect or
 * a binding tracks it. `getToken` and `signOut` are plain functions. Every id and the role are `null` unless the
 * session is active: a pending session reads as signed out.
 * @since 1.0.0
 */
export interface AuthState {
  /** False until Clerk has loaded (always false on the server). */
  readonly isLoaded: Accessor<boolean>;
  /** True only for an active session. */
  readonly isSignedIn: Accessor<boolean>;
  /** The signed-in user's id, or `null` when signed out or while the user is not known yet. */
  readonly userId: Accessor<string | null>;
  /** The active session's id, or `null` when signed out. */
  readonly sessionId: Accessor<string | null>;
  /** The active organization's id, or `null` when signed out or when no organization is active. */
  readonly orgId: Accessor<string | null>;
  /** The user's role in the active organization, or `null` when there is no membership in it. */
  readonly orgRole: Accessor<string | null>;
  /**
   * A session token, or a JWT template token when `template` is given. Resolves `null` when there is
   * no active session, including after sign-out and when the session changed while the token was
   * fetched. A rejected request rejects the returned promise, so the caller decides what to show.
   * @param options The JWT template and whether to skip Clerk's cache. See {@link ClerkTokenOptions}.
   */
  getToken(options?: ClerkTokenOptions): Promise<string | null>;
  /**
   * Signs the current session out with `clerk.signOut(options)`. Resolves at once, without calling Clerk, when Clerk
   * has not loaded. A failed sign-out rejects.
   * @param options The session to end and where to go afterward. See {@link ClerkSignOutOptions}.
   */
  signOut(options?: ClerkSignOutOptions): Promise<void>;
}

/**
 * Returns the Clerk instance once it has loaded, or `null` before that. Use it for actions the
 * other hooks do not cover. The instance is typed as {@link ClerkLike}, the part of Clerk this package relies on.
 *
 * @returns An accessor of the loaded instance (or `null`, always on the server).
 * @throws Error `useClerk must be used inside <ClerkProvider>.` when called outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { useClerk } from "@shadow-js/clerk";
 *
 * export function OpenSignIn() {
 *   const clerk = useClerk();
 *   return (
 *     <button type="button" disabled={clerk() === null} onClick={() => clerk()?.openSignIn()}>
 *       Sign in
 *     </button>
 *   );
 * }
 * ```
 * @see {@link useAuth}
 * @since 1.0.0
 */
export function useClerk(): Accessor<ClerkLike | null> {
  return requireContext("useClerk").clerk;
}

/** The levels a re-verification can require (Clerk's names). */
const LEVELS: ReadonlySet<string> = new Set(["first_factor", "second_factor", "multi_factor"]);
/** Clerk's named policies, as the server sends them in a hint. */
const POLICY_LEVELS: Readonly<Record<string, string>> = {
  strict_mfa: "multi_factor",
  strict: "second_factor",
  moderate: "second_factor",
  lax: "second_factor",
};
/** The API error the server raises for a session that must be verified again. */
const SESSION_REVERIFICATION = "session_reverification_required";

/** `value[key]` for an object, otherwise `undefined`. */
function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** The level a hint asks for: a named policy or an explicit level, or `undefined` when neither is valid. */
function levelOf(reverification: unknown): string | undefined {
  if (typeof reverification === "string") return POLICY_LEVELS[reverification];
  const level = fieldOf(reverification, "level");
  return typeof level === "string" && LEVELS.has(level) ? level : undefined;
}

/** True for Clerk's answer that the session must be verified again (a `forbidden` `reverification-error`). */
function isReverificationHint(answer: unknown): boolean {
  const error = fieldOf(answer, "clerk_error");
  return (
    fieldOf(error, "type") === "forbidden" && fieldOf(error, "reason") === "reverification-error"
  );
}

/**
 * The body to look for Clerk's hint in. A `Response` is read from a clone, so the caller still gets the original with
 * its body unread; a body that is not JSON (a 204, text, HTML) or was already read holds no hint.
 */
async function hintBodyOf(value: unknown): Promise<unknown> {
  if (!(value instanceof Response)) return value;
  try {
    return await value.clone().json();
  } catch {
    // Not JSON, empty, or already consumed: there is no hint in it, so the response is the action's answer as it is.
    return undefined;
  }
}

/** The action's outcome: what it returned, and the body that is checked for a verification hint. */
interface Settled {
  readonly value: unknown;
  readonly hint: unknown;
}

/** Runs the action; a thrown API error that asks for a verification becomes the same hint a returned one is. */
async function settle(run: () => unknown): Promise<Settled> {
  try {
    const value = await run();
    return { value, hint: await hintBodyOf(value) };
  } catch (error) {
    const errors = fieldOf(error, "errors");
    const asksForVerification =
      Array.isArray(errors) &&
      errors.some((item) => fieldOf(item, "code") === SESSION_REVERIFICATION);
    if (asksForVerification) {
      const hint = { clerk_error: { type: "forbidden", reason: "reverification-error" } };
      return { value: hint, hint };
    }
    throw error;
  }
}

/** Opens the verification dialog and resolves once the visitor has verified; rejects when they cancel it. */
function requestVerification(clerk: ClerkLike | null, level: string | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const opened = openVerificationDialog(clerk, {
      ...(level === undefined
        ? {}
        : { level: level as NonNullable<ClerkReverificationProps["level"]> }),
      afterVerification: () => resolve(),
      afterVerificationCancelled: () =>
        reject(
          Object.assign(new Error("User canceled attempted verification"), {
            code: "reverification_cancelled",
          }),
        ),
    });
    // No public fallback exists for this dialog: the action must not run unverified.
    if (!opened) {
      reject(
        new Error(
          "Re-verification needs Clerk's verification dialog, which this Clerk instance does not have.",
        ),
      );
    }
  });
}

/**
 * Runs an action that may need the visitor to verify again, as Clerk's `useReverification` does. When the server
 * answers that the session is too old for a sensitive change, Clerk's verification dialog opens at the level the
 * server asked for, and the action runs again once the visitor has verified. A canceled verification rejects with
 * a `reverification_cancelled` error, and the action does not run again.
 *
 * The answer counts as "verify again" when it is Clerk's hint (`{ clerk_error: { type: "forbidden", reason:
 * "reverification-error" } }`), or when the action throws an error whose `errors` list holds the code
 * `session_reverification_required`. Any other thrown error rejects the wrapped action unchanged. An answer that is a
 * `Response` is looked at through a clone (`response.clone().json()`) for the hint only, and the original `Response`,
 * body unread, is what the wrapped action resolves to; a body that is not JSON is never a hint and never an error.
 *
 * @param fetcher The action. It may return the server's answer, or throw Clerk's API error.
 * @returns The wrapped action, with the same arguments. It resolves to the answer of the last run.
 * @throws Error inside the wrapped action: `"Re-verification needs Clerk's verification dialog, which this Clerk
 *   instance does not have."` when the instance has no verification dialog or Clerk has not loaded (the action is not
 *   run again), and `"User canceled attempted verification"` with `code: "reverification_cancelled"` when the visitor
 *   cancels. Calling the hook outside a `ClerkProvider` throws an Error naming `useClerk`.
 * @example
 * ```tsx
 * import { useSignal } from "@shadow-js/core";
 * import { useReverification } from "@shadow-js/clerk";
 *
 * async function changeEmail(email: string): Promise<unknown> {
 *   const response = await fetch("/api/account/email", {
 *     method: "POST",
 *     body: JSON.stringify({ email }),
 *   });
 *   return response.json();
 * }
 *
 * export function SaveEmail(props: { email: string }) {
 *   const save = useReverification(changeEmail);
 *   const [notice, setNotice] = useSignal("");
 *   const run = (): void => {
 *     save(props.email).then(
 *       () => setNotice("Saved"),
 *       (error: unknown) => setNotice(String(error)),
 *     );
 *   };
 *   return (
 *     <div>
 *       <button type="button" onClick={run}>Save</button>
 *       <p role="status">{notice()}</p>
 *     </div>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function useReverification<A extends readonly unknown[], R>(
  fetcher: (...args: A) => R,
): (...args: A) => Promise<Awaited<R>> {
  const clerk = useClerk();
  const run = async (...args: A): Promise<unknown> => {
    let answer = await settle(() => fetcher(...args));
    if (isReverificationHint(answer.hint)) {
      const reverification = fieldOf(fieldOf(answer.hint, "clerk_error"), "metadata");
      await requestVerification(
        untrack(() => clerk()),
        levelOf(fieldOf(reverification, "reverification")),
      );
      answer = await settle(() => fetcher(...args));
    }
    return answer.value;
  };
  // The answer is the fetcher's own result (the resolved value), once the visitor has verified when asked.
  return run as (...args: A) => Promise<Awaited<R>>;
}

/**
 * Reads the auth state of the current user: whether Clerk has loaded, whether a session is active, the ids and the
 * organization role, and the `getToken` and `signOut` actions. See {@link AuthState}.
 *
 * @returns The accessors and actions described by {@link AuthState}.
 * @throws Error `useAuth must be used inside <ClerkProvider>.` when called outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { useAuth } from "@shadow-js/clerk";
 *
 * export function Profile() {
 *   const auth = useAuth();
 *   const load = async (): Promise<void> => {
 *     const token = await auth.getToken();
 *     if (token === null) return;
 *     await fetch("/api/me", { headers: { authorization: `Bearer ${token}` } });
 *   };
 *   return (
 *     <div>
 *       <p>{auth.isSignedIn() ? `Signed in as ${auth.userId()}` : "Signed out"}</p>
 *       <button type="button" onClick={() => void load()}>Load profile</button>
 *     </div>
 *   );
 * }
 * ```
 * @see {@link useUser}
 * @see {@link useSession}
 * @since 1.0.0
 */
export function useAuth(): AuthState {
  const ctx = requireContext("useAuth");
  const userId = useMemo<string | null>(() => (ctx.isSignedIn() ? (ctx.user()?.id ?? null) : null));
  const sessionId = useMemo<string | null>(() =>
    ctx.isSignedIn() ? (ctx.session()?.id ?? null) : null,
  );
  const orgId = useMemo<string | null>(() => {
    if (!ctx.isSignedIn()) return null;
    return ctx.organization()?.id ?? null;
  });
  const orgRole = useMemo<string | null>(() =>
    ctx.isSignedIn() ? (ctx.membership()?.role ?? null) : null,
  );

  return {
    isLoaded: ctx.isLoaded,
    isSignedIn: ctx.isSignedIn,
    userId,
    sessionId,
    orgId,
    orgRole,
    getToken: async (options) => {
      const session = untrack(() => ctx.session());
      if (session === null || session === undefined || session.status !== "active") return null;
      const token = await session.getToken(options);
      // A session that ended while the token was in flight must not hand its token out.
      const current = untrack(() => ctx.session());
      if (current === null || current === undefined || current.id !== session.id) return null;
      return token;
    },
    signOut: (options) => {
      const clerk = untrack(() => ctx.clerk());
      if (clerk === null) return Promise.resolve();
      return clerk.signOut(options);
    },
  };
}

/**
 * Returned by {@link useUser}. Every field is an accessor.
 * @since 1.0.0
 */
export interface UserState {
  /** True once the user is known: a user, or the knowledge that there is none. */
  readonly isLoaded: Accessor<boolean>;
  /** True only for an active session, as {@link AuthState.isSignedIn}. */
  readonly isSignedIn: Accessor<boolean>;
  /** The user, `null` when signed out, `undefined` while loading. */
  readonly user: Accessor<ClerkUserLike | null | undefined>;
}

/**
 * Reads the signed-in user. See {@link UserState}.
 *
 * @returns The accessors described by {@link UserState}.
 * @throws Error `useUser must be used inside <ClerkProvider>.` when called outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { useUser } from "@shadow-js/clerk";
 *
 * export function UserId() {
 *   const { isLoaded, user } = useUser();
 *   return <p>{isLoaded() ? (user()?.id ?? "Signed out") : "Loading"}</p>;
 * }
 * ```
 * @since 1.0.0
 */
export function useUser(): UserState {
  const ctx = requireContext("useUser");
  return {
    isLoaded: useMemo<boolean>(() => ctx.isLoaded() && ctx.user() !== undefined),
    isSignedIn: ctx.isSignedIn,
    user: ctx.user,
  };
}

/**
 * Returned by {@link useSession}. Every field is an accessor.
 * @since 1.0.0
 */
export interface SessionState {
  /** True once the session is known: a session, or the knowledge that there is none. */
  readonly isLoaded: Accessor<boolean>;
  /** True only for an active session, as {@link AuthState.isSignedIn}. */
  readonly isSignedIn: Accessor<boolean>;
  /** The session, `null` when signed out, `undefined` while loading. */
  readonly session: Accessor<ClerkSessionLike | null | undefined>;
}

/**
 * Reads the current session. See {@link SessionState}. The session is Clerk's own; a pending session is returned
 * as it is, while `isSignedIn` stays false for it.
 *
 * @returns The accessors described by {@link SessionState}.
 * @throws Error `useSession must be used inside <ClerkProvider>.` when called outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { useSession } from "@shadow-js/clerk";
 *
 * export function SessionStatus() {
 *   const { isLoaded, session } = useSession();
 *   return <p>{isLoaded() ? (session()?.status ?? "No session") : "Loading"}</p>;
 * }
 * ```
 * @since 1.0.0
 */
export function useSession(): SessionState {
  const ctx = requireContext("useSession");
  return {
    isLoaded: useMemo<boolean>(() => ctx.isLoaded() && ctx.session() !== undefined),
    isSignedIn: ctx.isSignedIn,
    session: ctx.session,
  };
}

/**
 * Returned by {@link useOrganization}. Every field is an accessor.
 * @since 1.0.0
 */
export interface OrganizationState {
  /** True once the active organization is known: an organization, or the knowledge that there is none. */
  readonly isLoaded: Accessor<boolean>;
  /** The active organization, `null` when there is none, `undefined` while loading. */
  readonly organization: Accessor<ClerkOrganizationLike | null | undefined>;
  /** The user's membership in the active organization, or `null` when signed out, when no organization is active or when the user has no membership in it. */
  readonly membership: Accessor<ClerkMembershipLike | null>;
}

/**
 * Reads the active organization and the user's membership in it. The membership carries the role and permissions that
 * {@link Protect} checks.
 *
 * @returns The accessors described by {@link OrganizationState}.
 * @throws Error `useOrganization must be used inside <ClerkProvider>.` when called outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { useOrganization } from "@shadow-js/clerk";
 *
 * export function OrganizationRole() {
 *   const { organization, membership } = useOrganization();
 *   return (
 *     <p>
 *       {organization() ? `Role: ${membership()?.role ?? "none"}` : "No active organization"}
 *     </p>
 *   );
 * }
 * ```
 * @see {@link useOrganizationList}
 * @since 1.0.0
 */
export function useOrganization(): OrganizationState {
  const ctx = requireContext("useOrganization");
  return {
    isLoaded: useMemo<boolean>(() => ctx.isLoaded() && ctx.organization() !== undefined),
    organization: ctx.organization,
    membership: ctx.membership,
  };
}

/**
 * Returned by {@link useOrganizationList}. `setActive` makes an organization the active one.
 * @since 1.0.0
 */
export interface OrganizationListState {
  /** True once the user is known: a user, or the knowledge that there is none. */
  readonly isLoaded: Accessor<boolean>;
  /**
   * The user's memberships: `undefined` while Clerk is loading, `[]` when signed out. Each membership
   * has the organization's `id` and the user's `role` and `permissions` in it.
   */
  readonly memberships: Accessor<readonly ClerkMembershipLike[] | undefined>;
  /**
   * Makes the organization the active one (`null` for none), with `clerk.setActive(params)`.
   * @param params The organization id, and optionally the session to activate with it.
   * @throws Error `setActive() called before Clerk has loaded.` (as a rejection) before Clerk has loaded.
   */
  setActive(params: { organization: string | null; session?: string | null }): Promise<void>;
}

/**
 * Reads the organizations the signed-in user belongs to, and selects one. For the Clerk UI, mount
 * `OrganizationList` or `OrganizationSwitcher` instead.
 *
 * @returns The accessors and action described by {@link OrganizationListState}.
 * @throws Error `useOrganizationList must be used inside <ClerkProvider>.` when called outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { useOrganizationList } from "@shadow-js/clerk";
 * import { For } from "@shadow-js/web";
 *
 * export function OrganizationPicker() {
 *   const orgs = useOrganizationList();
 *   return (
 *     <For each={orgs.memberships() ?? []}>
 *       {(membership) => (
 *         <button
 *           type="button"
 *           onClick={() => void orgs.setActive({ organization: membership.organization.id })}
 *         >
 *           {membership.organization.id} ({membership.role})
 *         </button>
 *       )}
 *     </For>
 *   );
 * }
 * ```
 * @see {@link OrganizationSwitcher}
 * @since 1.0.0
 */
export function useOrganizationList(): OrganizationListState {
  const ctx = requireContext("useOrganizationList");
  return {
    isLoaded: useMemo<boolean>(() => ctx.isLoaded() && ctx.user() !== undefined),
    memberships: useMemo<readonly ClerkMembershipLike[] | undefined>(() => {
      const user = ctx.user();
      if (!ctx.isLoaded() || user === undefined) return undefined;
      if (user === null) return [];
      return user.organizationMemberships ?? [];
    }),
    setActive: async (params) => {
      const clerk = untrack(() => ctx.clerk());
      if (clerk === null) throw new Error("setActive() called before Clerk has loaded.");
      await clerk.setActive(params);
    },
  };
}

/**
 * Returned by {@link useSignIn}. `signIn` is clerk-js's future sign-in resource, with `reset`, `sso` and the factor
 * methods; `errors` and `fetchStatus` describe its last fetch. `setActive` makes a finished session the active one.
 * Every field is an accessor, so reading one in a binding or an effect tracks it.
 * @since 1.0.0
 */
export interface SignInState {
  /** True once Clerk has loaded and its client resource is known. */
  readonly isLoaded: Accessor<boolean>;
  /** The in-progress sign-in, or `null` (before Clerk has loaded, or when clerk-js does not expose the future API). */
  readonly signIn: Accessor<ClerkSignInFuture | null>;
  /** The errors of the last fetch of the sign-in. */
  readonly errors: Accessor<ClerkFlowErrors>;
  /** `fetching` while clerk-js is fetching the sign-in. */
  readonly fetchStatus: Accessor<ClerkFetchStatus>;
  /**
   * Makes a session (and optionally an organization) the active one, with `clerk.setActive(params)`.
   * @param params The session id and the organization id, `null` for none.
   * @throws Error `setActive() called before Clerk has loaded.` (as a rejection) before Clerk has loaded.
   */
  setActive(params: { session?: string | null; organization?: string | null }): Promise<void>;
}

/**
 * Reads clerk-js's future sign-in state and provides `setActive`. Build custom sign-in forms on `signIn()`: for example
 * `signIn()?.sso({ strategy: "oauth_google", redirectUrl, redirectCallbackUrl })`.
 * The future API needs `@clerk/clerk-js` 6.38.1 or later; with an older one `signIn()` stays `null` and one
 * `console.error` names the version to upgrade to.
 *
 * @returns The accessors and action described by {@link SignInState}.
 * @throws Error `useSignIn must be used inside <ClerkProvider>.` when called outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { useSignIn } from "@shadow-js/clerk";
 *
 * export function GoogleSignIn() {
 *   const signIn = useSignIn();
 *   const start = async (): Promise<void> => {
 *     const attempt = signIn.signIn();
 *     if (attempt === null) return;
 *     await attempt.reset();
 *     await attempt.sso({
 *       strategy: "oauth_google",
 *       redirectUrl: "/",
 *       redirectCallbackUrl: "/sso-callback",
 *     });
 *   };
 *   return (
 *     <div>
 *       <button type="button" disabled={signIn.signIn() === null} onClick={() => void start()}>
 *         Continue with Google
 *       </button>
 *       <p role="alert">{signIn.errors().global?.[0]?.message}</p>
 *     </div>
 *   );
 * }
 * ```
 * @see {@link ClerkSignInFuture}
 * @see {@link HandleSSOCallback}
 * @since 1.0.0
 */
export function useSignIn(): SignInState {
  const ctx = requireContext("useSignIn");
  return {
    isLoaded: useMemo<boolean>(() => ctx.isLoaded() && ctx.client() !== undefined),
    signIn: () => ctx.signIn().resource,
    errors: () => ctx.signIn().errors,
    fetchStatus: () => ctx.signIn().fetchStatus,
    setActive: async (params) => {
      const clerk = untrack(() => ctx.clerk());
      if (clerk === null) throw new Error("setActive() called before Clerk has loaded.");
      await clerk.setActive(params);
    },
  };
}

/**
 * Returned by {@link useSignUp}: the future sign-up resource, its errors and fetch status, and `setActive`. See
 * {@link SignInState}.
 * @since 1.0.0
 */
export interface SignUpState {
  /** True once Clerk has loaded and its client resource is known. */
  readonly isLoaded: Accessor<boolean>;
  /** The in-progress sign-up, or `null` (before Clerk has loaded, or when clerk-js does not expose the future API). */
  readonly signUp: Accessor<ClerkSignUpFuture | null>;
  /** The errors of the last fetch of the sign-up. */
  readonly errors: Accessor<ClerkFlowErrors>;
  /** `fetching` while clerk-js is fetching the sign-up. */
  readonly fetchStatus: Accessor<ClerkFetchStatus>;
  /**
   * Makes a session (and optionally an organization) the active one, with `clerk.setActive(params)`.
   * @param params The session id and the organization id, `null` for none.
   * @throws Error `setActive() called before Clerk has loaded.` (as a rejection) before Clerk has loaded.
   */
  setActive(params: { session?: string | null; organization?: string | null }): Promise<void>;
}

/**
 * Reads clerk-js's future sign-up state and provides `setActive`. Build custom sign-up forms on `signUp()`, the same
 * way {@link useSignIn} builds sign-in forms. It needs the same clerk-js version as {@link useSignIn}.
 *
 * @returns The accessors and action described by {@link SignUpState}.
 * @throws Error `useSignUp must be used inside <ClerkProvider>.` when called outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { useSignal } from "@shadow-js/core";
 * import { useSignUp } from "@shadow-js/clerk";
 *
 * export function EmailSignUp() {
 *   const signUp = useSignUp();
 *   const [email, setEmail] = useSignal("");
 *   const [password, setPassword] = useSignal("");
 *   const [message, setMessage] = useSignal<string | null>(null);
 *
 *   const submit = async (): Promise<void> => {
 *     const attempt = signUp.signUp();
 *     if (attempt === null) return;
 *     const created = await attempt.password({ emailAddress: email(), password: password() });
 *     if (created.error !== null) {
 *       setMessage(created.error.longMessage ?? created.error.message);
 *       return;
 *     }
 *     const sent = await attempt.verifications.sendEmailCode();
 *     setMessage(sent.error === null ? "Check your email for a code." : sent.error.message);
 *   };
 *
 *   return (
 *     <form
 *       onSubmit={(event) => {
 *         event.preventDefault();
 *         void submit();
 *       }}
 *     >
 *       <input
 *         type="email"
 *         value={email()}
 *         onInput={(event) => setEmail((event.currentTarget as HTMLInputElement).value)}
 *       />
 *       <input
 *         type="password"
 *         value={password()}
 *         onInput={(event) => setPassword((event.currentTarget as HTMLInputElement).value)}
 *       />
 *       <button type="submit" disabled={signUp.fetchStatus() === "fetching"}>Sign up</button>
 *       <p role="alert">{message()}</p>
 *     </form>
 *   );
 * }
 * ```
 * @see {@link ClerkSignUpFuture}
 * @since 1.0.0
 */
export function useSignUp(): SignUpState {
  const ctx = requireContext("useSignUp");
  return {
    isLoaded: useMemo<boolean>(() => ctx.isLoaded() && ctx.client() !== undefined),
    signUp: () => ctx.signUp().resource,
    errors: () => ctx.signUp().errors,
    fetchStatus: () => ctx.signUp().fetchStatus,
    setActive: async (params) => {
      const clerk = untrack(() => ctx.clerk());
      if (clerk === null) throw new Error("setActive() called before Clerk has loaded.");
      await clerk.setActive(params);
    },
  };
}
