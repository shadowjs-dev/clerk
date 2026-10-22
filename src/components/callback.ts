import { useEffect } from "@shadow-js/core";
import { attempt, readOptions } from "../internal/actions";
import { requireContext } from "../internal/context";
import type { ClerkRedirectOptions } from "../types";

/**
 * Completes an OAuth or SSO sign-in on the route Clerk redirects back to. Put it on that route:
 * once Clerk has loaded it calls `clerk.handleRedirectCallback()` with its options, which finishes the
 * sign-in and sends the user on to `afterSignInUrl` (or `afterSignUpUrl` for a new account). Renders
 * nothing, and does nothing on the server. A failure goes to the nearest ErrorBoundary. For a custom flow started
 * with `useSignIn().signIn()?.sso()`, use {@link HandleSSOCallback} instead.
 *
 * @param props Options forwarded to `clerk.handleRedirectCallback()`. See {@link ClerkRedirectOptions}.
 * @returns `undefined`: the component renders nothing.
 * @throws Error `AuthenticateWithRedirectCallback must be used inside <ClerkProvider>.` when rendered outside a
 *   `ClerkProvider`.
 * @example
 * ```tsx
 * import { AuthenticateWithRedirectCallback } from "@shadow-js/clerk";
 *
 * export default function SsoCallback() {
 *   return <AuthenticateWithRedirectCallback afterSignInUrl="/dashboard" afterSignUpUrl="/welcome" />;
 * }
 * ```
 * @since 1.0.0
 */
export function AuthenticateWithRedirectCallback(props: ClerkRedirectOptions): unknown {
  const ctx = requireContext("AuthenticateWithRedirectCallback");
  useEffect(() => {
    const clerk = ctx.clerk();
    if (clerk === null) return;
    const options = readOptions(props, []);
    attempt(() => clerk.handleRedirectCallback(options), ctx.fail);
  });
  return undefined;
}
