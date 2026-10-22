import { useEffect } from "@shadow-js/core";
import { Show } from "@shadow-js/web";
import { attempt, readOptions } from "../internal/actions";
import { type AccessCheck, membershipAllows, requireContext } from "../internal/context";
import type { ClerkLike, ClerkRedirectOptions } from "../types";

/**
 * Props shared by the components that show one of two branches ({@link SignedIn}, {@link SignedOut},
 * {@link Protect}, {@link ClerkLoading}, {@link ClerkLoaded}, {@link AuthLoading}).
 * @since 1.0.0
 */
export interface GuardProps {
  /** Shown when the condition holds. */
  readonly children?: unknown;
  /** Shown otherwise, including before Clerk has loaded (except for the loading guards). Renders nothing when omitted. */
  readonly fallback?: unknown;
}

/**
 * Props of {@link Protect}.
 * @since 1.0.0
 */
export interface ProtectProps extends GuardProps {
  /** The organization role the user must hold in the active organization, e.g. `"org:admin"`. */
  readonly role?: string;
  /** The organization permission the user must hold in the active organization. */
  readonly permission?: string;
  /**
   * Extra check, given the same `has` function as the other criteria. `has({ role, permission })` is true when the
   * membership in the active organization has every key given; `has({})` is false. Runs inside the guard's
   * reactive scope, so the guard updates when the membership changes.
   */
  readonly condition?: (has: (check: AccessCheck) => boolean) => boolean;
}

/**
 * Shows its children while the user is signed in (an active session). Before Clerk has loaded, on the server, and
 * when signed out or pending, it shows `fallback`.
 *
 * @param props See {@link GuardProps}.
 * @returns The content, as a reactive branch.
 * @throws Error `SignedIn must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { SignedIn, UserButton } from "@shadow-js/clerk";
 *
 * export function Header() {
 *   return (
 *     <SignedIn fallback={<a href="/sign-in">Sign in</a>}>
 *       <UserButton />
 *     </SignedIn>
 *   );
 * }
 * ```
 * @see {@link SignedOut}
 * @see {@link Protect}
 * @since 1.0.0
 */
export function SignedIn(props: GuardProps): unknown {
  const ctx = requireContext("SignedIn");
  return Show({
    get when() {
      return ctx.isLoaded() && ctx.isSignedIn();
    },
    get children() {
      return props.children;
    },
    get fallback() {
      return props.fallback;
    },
  });
}

/**
 * Shows its children once Clerk has loaded and the user is signed out (a pending session counts as signed out).
 * Before Clerk has loaded, on the server, and while signed in, it shows `fallback`.
 *
 * @param props See {@link GuardProps}.
 * @returns The content, as a reactive branch.
 * @throws Error `SignedOut must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { SignedOut, SignInButton } from "@shadow-js/clerk";
 *
 * export function Welcome() {
 *   return (
 *     <SignedOut>
 *       <SignInButton />
 *     </SignedOut>
 *   );
 * }
 * ```
 * @see {@link SignedIn}
 * @since 1.0.0
 */
export function SignedOut(props: GuardProps): unknown {
  const ctx = requireContext("SignedOut");
  return Show({
    get when() {
      return ctx.isLoaded() && !ctx.isSignedIn();
    },
    get children() {
      return props.children;
    },
    get fallback() {
      return props.fallback;
    },
  });
}

/**
 * Shows its children when the user is signed in and passes the role, permission and condition
 * checks, all of those that are given. With none given, being signed in is enough. Roles and
 * permissions are read from the membership in the active organization, so without an active organization a role or
 * permission check fails. Otherwise, and before Clerk has loaded, it shows `fallback`. It hides content in the
 * browser only; authorize on the server too.
 *
 * @param props See {@link ProtectProps}.
 * @returns The content, as a reactive branch.
 * @throws Error `Protect must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { OrganizationProfile, Protect } from "@shadow-js/clerk";
 *
 * export function Settings() {
 *   return (
 *     <Protect role="org:admin" fallback={<p>Only admins can change the organization.</p>}>
 *       <OrganizationProfile path="/organization" routing="path" />
 *     </Protect>
 *   );
 * }
 * ```
 * @see {@link useOrganization}
 * @since 1.0.0
 */
export function Protect(props: ProtectProps): unknown {
  const ctx = requireContext("Protect");
  const has = (check: AccessCheck): boolean => membershipAllows(ctx.membership(), check);
  return Show({
    get when() {
      if (!ctx.isLoaded() || !ctx.isSignedIn()) return false;
      if (props.role !== undefined || props.permission !== undefined) {
        const check = { role: props.role, permission: props.permission };
        if (!membershipAllows(ctx.membership(), check)) return false;
      }
      const condition = props.condition;
      if (condition !== undefined && !condition(has)) return false;
      return true;
    },
    get children() {
      return props.children;
    },
    get fallback() {
      return props.fallback;
    },
  });
}

/**
 * Shows its children while Clerk has not loaded yet, which includes the server render. Once Clerk has loaded it shows
 * `fallback`.
 *
 * @param props See {@link GuardProps}.
 * @returns The content, as a reactive branch.
 * @throws Error `ClerkLoading must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { ClerkLoaded, ClerkLoading, UserButton } from "@shadow-js/clerk";
 *
 * export function AccountSlot() {
 *   return (
 *     <>
 *       <ClerkLoading>
 *         <span>Loading</span>
 *       </ClerkLoading>
 *       <ClerkLoaded>
 *         <UserButton />
 *       </ClerkLoaded>
 *     </>
 *   );
 * }
 * ```
 * @see {@link ClerkLoaded}
 * @see {@link AuthLoading}
 * @since 1.0.0
 */
export function ClerkLoading(props: GuardProps): unknown {
  const ctx = requireContext("ClerkLoading");
  return Show({
    get when() {
      return !ctx.isLoaded();
    },
    get children() {
      return props.children;
    },
    get fallback() {
      return props.fallback;
    },
  });
}

/**
 * Shows its children once Clerk has loaded, signed in or not. Before that, and on the server, it shows `fallback`.
 *
 * @param props See {@link GuardProps}.
 * @returns The content, as a reactive branch.
 * @throws Error `ClerkLoaded must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { ClerkLoaded, SignIn } from "@shadow-js/clerk";
 *
 * export function SignInPage() {
 *   return (
 *     <ClerkLoaded fallback={<p>Loading sign-in</p>}>
 *       <SignIn path="/sign-in" routing="path" />
 *     </ClerkLoaded>
 *   );
 * }
 * ```
 * @see {@link ClerkLoading}
 * @since 1.0.0
 */
export function ClerkLoaded(props: GuardProps): unknown {
  const ctx = requireContext("ClerkLoaded");
  return Show({
    get when() {
      return ctx.isLoaded();
    },
    get children() {
      return props.children;
    },
    get fallback() {
      return props.fallback;
    },
  });
}

/**
 * Same condition as {@link ClerkLoading}: shown while the auth state is still unknown. Exported
 * under this name for parity with the Clerk and Convex naming. It does not wait for Convex; that is `AuthLoading`
 * of `@shadow-js/convex`.
 *
 * @param props See {@link GuardProps}.
 * @returns The content, as a reactive branch.
 * @throws Error `ClerkLoading must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { AuthLoading } from "@shadow-js/clerk";
 *
 * export function Spinner() {
 *   return (
 *     <AuthLoading>
 *       <p aria-busy="true">Checking your session</p>
 *     </AuthLoading>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function AuthLoading(props: GuardProps): unknown {
  return ClerkLoading(props);
}

/**
 * Redirects to the sign-in page as soon as Clerk has loaded and the user is signed out. Renders
 * nothing, and does nothing while signed in, before Clerk has loaded or on the server. A failed redirect throws to
 * the nearest ErrorBoundary.
 *
 * @param props Redirect options, forwarded to `clerk.redirectToSignIn()`. See {@link ClerkRedirectOptions}.
 * @returns `undefined`: the component renders nothing.
 * @throws Error `RedirectToSignIn must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { RedirectToSignIn, SignedIn, SignedOut } from "@shadow-js/clerk";
 *
 * export function Dashboard() {
 *   return (
 *     <>
 *       <SignedIn>
 *         <h1>Dashboard</h1>
 *       </SignedIn>
 *       <SignedOut>
 *         <RedirectToSignIn redirectUrl="/dashboard" />
 *       </SignedOut>
 *     </>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function RedirectToSignIn(props: ClerkRedirectOptions): unknown {
  return redirectWhenSignedOut("RedirectToSignIn", props, (clerk, options) =>
    clerk.redirectToSignIn(options),
  );
}

/**
 * Redirects to the sign-up page as soon as Clerk has loaded and the user is signed out. Renders
 * nothing. Same rules as {@link RedirectToSignIn}.
 *
 * @param props Redirect options, forwarded to `clerk.redirectToSignUp()`. See {@link ClerkRedirectOptions}.
 * @returns `undefined`: the component renders nothing.
 * @throws Error `RedirectToSignUp must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { RedirectToSignUp } from "@shadow-js/clerk";
 *
 * export default function Join() {
 *   return <RedirectToSignUp signUpForceRedirectUrl="/welcome" />;
 * }
 * ```
 * @since 1.0.0
 */
export function RedirectToSignUp(props: ClerkRedirectOptions): unknown {
  return redirectWhenSignedOut("RedirectToSignUp", props, (clerk, options) =>
    clerk.redirectToSignUp(options),
  );
}

/**
 * The shared body of the redirect components: once Clerk has loaded and no session is active, the
 * redirect runs once per change of the instance. A failure goes to the provider's error path.
 */
function redirectWhenSignedOut(
  name: string,
  props: ClerkRedirectOptions,
  redirect: (clerk: ClerkLike, options: Record<string, unknown>) => unknown,
): unknown {
  const ctx = requireContext(name);
  useEffect(() => {
    const clerk = ctx.clerk();
    if (clerk === null || ctx.isSignedIn()) return;
    const options = readOptions(props, []);
    attempt(() => redirect(clerk, options), ctx.fail);
  });
  return undefined;
}
