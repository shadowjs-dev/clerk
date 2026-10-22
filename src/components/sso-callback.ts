import { untrack, useEffect } from "@shadow-js/core";
import { requireContext } from "../internal/context";
import type { ClerkAttemptLike, ClerkClientLike, ClerkLike } from "../types";

/**
 * The parts of a sign-in or sign-up attempt the callback reads and calls. `create({ transfer: true })` is
 * how Clerk moves a first-time account to a sign-up (and back): it exists on the live resources only.
 * Not exported from a package entry; {@link HandleSSOCallback} reads the attempts of the client in this shape.
 * @internal
 */
export interface SsoAttempt extends ClerkAttemptLike {
  /** True when Clerk can move the sign-in to a sign-up (a first-time SSO account). */
  readonly isTransferable?: boolean;
  /** The id of the session a completed attempt created, made active by the callback. */
  readonly createdSessionId?: string | null;
}

/**
 * Where {@link HandleSSOCallback} sends the browser, and how. Every field is optional.
 * @since 1.0.0
 */
export interface HandleSSOCallbackProps {
  /**
   * Sign-in route for a sign-in that needs another step (identifier, first or second factor, new password).
   * @default "/sign-in"
   */
  readonly signInUrl?: string;
  /**
   * Sign-up route for a first-time account whose transferred sign-up is not complete yet.
   * @default "/sign-up"
   */
  readonly signUpUrl?: string;
  /**
   * Where a completed sign-in goes.
   * @default "/"
   */
  readonly afterSignInUrl?: string;
  /**
   * Where a completed sign-up goes.
   * @default "/"
   */
  readonly afterSignUpUrl?: string;
  /**
   * Performs the navigation (the router's `navigate` in a ShadowJS app). Default: `location.replace`, the
   * same as a document redirect, for destinations on this page's origin only (any other, `javascript:` URLs
   * included, makes the callback fail with a `TypeError` before it signs anyone in). Every navigation the
   * callback makes replaces the callback's history entry.
   */
  readonly navigate?: (to: string, options: { readonly replace: true }) => void;
}

/**
 * What the callback did: `signed-in` (session activated, sent to `afterSignInUrl`), `signed-up` (session activated,
 * sent to `afterSignUpUrl`), `transfer-to-sign-up` (sent to `signUpUrl` to finish the sign-up), `sign-in` (a step is
 * needed on the sign-in page), or `waiting` (nothing to do yet).
 * @since 1.0.0
 */
export type SsoOutcome = "signed-in" | "signed-up" | "transfer-to-sign-up" | "sign-in" | "waiting";

/** Sign-in statuses that continue on the sign-in page. */
const SIGN_IN_STEPS: ReadonlySet<string> = new Set([
  "needs_identifier",
  "needs_first_factor",
  "needs_second_factor",
  "needs_new_password",
]);

/** A resource with `create`: the live Clerk attempts have it, the status-only shape does not. */
type Creatable = SsoAttempt & {
  readonly create: (options: { transfer: boolean }) => Promise<SsoAttempt>;
};

function isCreatable(attempt: SsoAttempt | null): attempt is Creatable {
  return attempt !== null && typeof Reflect.get(attempt, "create") === "function";
}

/**
 * A destination for the default navigation (`location.replace`): a URL on the page's own origin. `location.replace`
 * runs a `javascript:` URL and follows any other origin, so a destination copied from the query string
 * (`afterSignInUrl={params.get("redirect_url")}`) would be a script injection and an open redirect. A destination
 * on another origin goes through your own `navigate`.
 */
function ownOrigin(to: string): string {
  const url = new URL(to, globalThis.location.href);
  if (url.origin !== globalThis.location.origin) {
    throw new TypeError(
      "HandleSSOCallback: a destination must be on this page's origin, or be navigated with the navigate prop.",
    );
  }
  return url.href;
}

/** The resolved routes, with the defaults applied. */
interface Routes {
  readonly signIn: string;
  readonly signUp: string;
  readonly afterSignIn: string;
  readonly afterSignUp: string;
  readonly navigate: (to: string, options: { readonly replace: true }) => void;
}

/**
 * The state machine of Clerk's `HandleSSOCallback`, run once the callback page has loaded Clerk:
 * - a completed sign-in activates its session and goes to `afterSignInUrl` (replacing the entry);
 * - a first-time account (the sign-in is transferable) is transferred to a sign-up: a completed sign-up
 *   goes to `afterSignUpUrl`, an unfinished one goes to `signUpUrl`;
 * - a sign-in that needs another step (second factor, new password, identifier) goes to `signInUrl`;
 * - a completed sign-up goes to `afterSignUpUrl`.
 * Anything else waits: the resources are not final yet.
 *
 * @param clerk The loaded Clerk.
 * @param client The client resource with the in-progress sign-in and sign-up attempts.
 * @param routes Where each outcome goes.
 * @returns The outcome that was carried out.
 * @internal
 */
export async function finishSsoCallback(
  clerk: Pick<ClerkLike, "setActive">,
  client: Pick<ClerkClientLike, "signIn" | "signUp">,
  routes: Routes,
): Promise<SsoOutcome> {
  const signIn = (client.signIn ?? null) as SsoAttempt | null;
  const signUp = (client.signUp ?? null) as SsoAttempt | null;
  if (signIn?.status === "complete") {
    await clerk.setActive({ session: signIn.createdSessionId ?? null });
    routes.navigate(routes.afterSignIn, { replace: true });
    return "signed-in";
  }
  if (signIn?.isTransferable === true && isCreatable(signUp)) {
    const created = await signUp.create({ transfer: true });
    if (created.status === "complete") {
      await clerk.setActive({ session: created.createdSessionId ?? null });
      routes.navigate(routes.afterSignUp, { replace: true });
      return "signed-up";
    }
    routes.navigate(routes.signUp, { replace: true });
    return "transfer-to-sign-up";
  }
  if (signUp?.status === "complete") {
    await clerk.setActive({ session: signUp.createdSessionId ?? null });
    routes.navigate(routes.afterSignUp, { replace: true });
    return "signed-up";
  }
  if (signIn !== null && signIn.status !== null && SIGN_IN_STEPS.has(signIn.status)) {
    routes.navigate(routes.signIn, { replace: true });
    return "sign-in";
  }
  return "waiting";
}

/**
 * Finishes an SSO sign-in on the route Clerk redirects back to: the equivalent of Clerk's
 * `HandleSSOCallback`, for `@shadow-js/clerk`. Put it on the `redirectCallbackUrl` route of a custom flow
 * (`useSignIn().signIn()?.sso(...)`). It runs once per mount, after Clerk has loaded:
 * - a completed sign-in activates its session and goes to `afterSignInUrl`;
 * - a first-time account (a transferable sign-in) is transferred to a sign-up: a completed one goes to
 *   `afterSignUpUrl`, an unfinished one to `signUpUrl`;
 * - a completed sign-up activates its session and goes to `afterSignUpUrl`;
 * - a sign-in that needs another step goes to `signInUrl`;
 * - anything else waits, with no navigation.
 *
 * Every navigation replaces the history entry, so the callback is not in the history. It renders nothing. A failure
 * goes to the nearest ErrorBoundary.
 *
 * @param props Routes and the navigation. Every field is optional. See {@link HandleSSOCallbackProps}.
 * @returns `undefined`: the component renders nothing.
 * @throws Error `HandleSSOCallback must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 *   Without `navigate`, a route that is not on the page's origin fails with a `TypeError` (sent to the nearest
 *   ErrorBoundary) before anyone is signed in.
 * @example
 * ```tsx
 * import { HandleSSOCallback } from "@shadow-js/clerk";
 * import { useNavigate } from "@shadow-js/router";
 *
 * export default function SsoCallback() {
 *   const navigate = useNavigate();
 *   return (
 *     <HandleSSOCallback
 *       signInUrl="/sign-in"
 *       afterSignInUrl="/dashboard"
 *       navigate={(to, options) => void navigate(to, options)}
 *     />
 *   );
 * }
 * ```
 * @see {@link useSignIn}
 * @see {@link AuthenticateWithRedirectCallback}
 * @since 1.0.0
 */
export function HandleSSOCallback(props: HandleSSOCallbackProps): unknown {
  const ctx = requireContext("HandleSSOCallback");
  // A plain variable: the callback runs once per mount, as Clerk's did.
  let started = false;
  useEffect(() => {
    const clerk = ctx.clerk();
    const client = ctx.client();
    if (clerk === null || client === undefined || started) return;
    started = true;
    const routes: Routes = {
      signIn: props.signInUrl ?? "/sign-in",
      signUp: props.signUpUrl ?? "/sign-up",
      afterSignIn: props.afterSignInUrl ?? "/",
      afterSignUp: props.afterSignUpUrl ?? "/",
      navigate:
        props.navigate ??
        ((to) => {
          globalThis.location.replace(ownOrigin(to));
        }),
    };
    if (props.navigate === undefined) {
      // Checked up front: a destination found wrong after `setActive` would leave the user signed in on an error page.
      try {
        for (const to of [routes.signIn, routes.signUp, routes.afterSignIn, routes.afterSignUp]) {
          ownOrigin(to);
        }
      } catch (error) {
        ctx.fail(error);
        return;
      }
    }
    untrack(() => {
      finishSsoCallback(clerk, client, routes).catch((error: unknown) => {
        ctx.fail(error);
      });
    });
  });
  return undefined;
}
