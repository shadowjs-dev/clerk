import { type Accessor, type Context, createContext, useContext } from "@shadow-js/core";
import type {
  ClerkClientLike,
  ClerkFlowSnapshot,
  ClerkLike,
  ClerkMembershipLike,
  ClerkOrganizationLike,
  ClerkSessionLike,
  ClerkSignInFuture,
  ClerkSignUpFuture,
  ClerkUserLike,
} from "../types";

/**
 * Everything the provider mirrors out of Clerk, as accessors that the hooks and components read.
 * `clerk` is non-null only once the SDK has loaded, so a component that mounts Clerk UI or calls
 * an action never reaches an instance that is not ready.
 * @internal
 */
export interface ClerkContextValue {
  /** The Clerk instance once loaded, else `null`. */
  readonly clerk: Accessor<ClerkLike | null>;
  /** The loaded flag of the last Clerk event. */
  readonly isLoaded: Accessor<boolean>;
  /** The client resource, `undefined` until known. */
  readonly client: Accessor<ClerkClientLike | undefined>;
  /** The user, `null` when signed out, `undefined` until known. */
  readonly user: Accessor<ClerkUserLike | null | undefined>;
  /** The session, `null` when signed out, `undefined` until known. */
  readonly session: Accessor<ClerkSessionLike | null | undefined>;
  /** The active organization, `null` for none, `undefined` until known. */
  readonly organization: Accessor<ClerkOrganizationLike | null | undefined>;
  /** True only for an active session, the only state in which the user is signed in. */
  readonly isSignedIn: Accessor<boolean>;
  /** The membership of the signed-in user in the active organization, if any. */
  readonly membership: Accessor<ClerkMembershipLike | null>;
  /** clerk-js's future sign-in state: the resource, its errors and the fetch status. Empty until Clerk has loaded. */
  readonly signIn: Accessor<ClerkFlowSnapshot<ClerkSignInFuture>>;
  /** clerk-js's future sign-up state, as {@link ClerkContextValue.signIn}. */
  readonly signUp: Accessor<ClerkFlowSnapshot<ClerkSignUpFuture>>;
  /** Routes an error to the nearest ErrorBoundary by throwing it from the provider's subtree. */
  readonly fail: (error: unknown) => void;
}

/**
 * The context of {@link ClerkProvider}. Created without a default, so reading it outside a
 * provider throws instead of returning a value that would silently be wrong.
 * @internal
 */
export const ClerkContext: Context<ClerkContextValue> = createContext<ClerkContextValue>(
  undefined,
  {
    name: "ClerkContext",
  },
);

/**
 * Reads the provider's context for the named hook or component. The error names the hook, which
 * is the first thing a developer needs when a provider is missing.
 * @internal
 */
export function requireContext(caller: string): ClerkContextValue {
  try {
    return useContext(ClerkContext);
  } catch (error) {
    throw new Error(`${caller} must be used inside <ClerkProvider>.`, { cause: error });
  }
}

/**
 * A role or permission check. Empty checks are not authorization decisions and never pass.
 * @internal
 */
export interface AccessCheck {
  /** The organization role the membership must have, compared exactly. */
  readonly role?: string | undefined;
  /** A permission the membership must include. */
  readonly permission?: string | undefined;
}

/**
 * Decides a role or permission check against the membership in the active organization. Without a
 * membership (no active organization, or signed out) the answer is always no.
 * @internal
 */
export function membershipAllows(
  membership: ClerkMembershipLike | null,
  check: AccessCheck,
): boolean {
  if (membership === null) return false;
  if (check.role === undefined && check.permission === undefined) return false;
  if (check.role !== undefined && membership.role !== check.role) return false;
  if (check.permission !== undefined) {
    const permissions = membership.permissions ?? [];
    if (!permissions.includes(check.permission)) return false;
  }
  return true;
}
