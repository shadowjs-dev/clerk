import { isServer, onCleanup, untrack } from "@shadow-js/core";
import { attempt, readOptions } from "../internal/actions";
import { type ClerkContextValue, requireContext } from "../internal/context";
import { clientPlaceholder, serverButton } from "../internal/placeholder";
import type { ClerkLike, ClerkRedirectOptions, ClerkSignOutOptions } from "../types";

/**
 * Props of {@link SignInButton} and {@link SignUpButton}. Every key except `mode` and `children` is forwarded to Clerk
 * as an option of `openSignIn` / `redirectToSignIn` (or the sign-up pair), read at the time of the click.
 * @since 1.0.0
 */
export interface AuthButtonProps extends ClerkRedirectOptions {
  /**
   * `"modal"` opens Clerk's dialog (`openSignIn` / `openSignUp`); `"redirect"` navigates to the sign-in or sign-up
   * page (`redirectToSignIn` / `redirectToSignUp`).
   * @default "modal"
   */
  readonly mode?: "modal" | "redirect";
  /**
   * An element to use as the button: the click handler is attached to it, and its own markup and styles are kept. A
   * string gives the default `<button type="button">` with that text; no child gives it the default label
   * (`"Sign in"`, `"Sign up"`).
   */
  readonly children?: unknown;
}

/**
 * Props of {@link SignOutButton}. Only `redirectUrl` and `sessionId` reach Clerk, and only when given.
 * @since 1.0.0
 */
export interface SignOutButtonProps {
  /** Where to navigate after sign-out, sent to `clerk.signOut()`. */
  readonly redirectUrl?: string;
  /** The session to sign out, in a multi-session app, sent to `clerk.signOut()`. */
  readonly sessionId?: string;
  /** Same meaning as {@link AuthButtonProps.children}; the default label is `"Sign out"`. */
  readonly children?: unknown;
}

/**
 * Renders a button that runs `run` on click. The child element, when given, is used as the button,
 * so the app keeps its own markup and styles. On the server the button is sent as markup with a
 * hydration key (an element child is sent as it is), and the browser claims it.
 */
function actionButton(
  ctx: ClerkContextValue,
  children: unknown,
  label: string,
  run: (clerk: ClerkLike) => unknown,
): unknown {
  if (isServer) {
    // An element child arrives on the server as markup already; text or no child needs a button.
    if (typeof children === "object" && children !== null) return children;
    return serverButton(typeof children === "string" ? children : label);
  }
  const element = buttonFor(children, label);
  const onClick = (): void => {
    attempt(() => {
      const clerk = ctx.clerk();
      if (clerk === null) return undefined;
      return run(clerk);
    }, ctx.fail);
  };
  element.addEventListener("click", onClick);
  onCleanup(() => {
    element.removeEventListener("click", onClick);
  });
  return element;
}

/**
 * The child element, or the default `<button>` labeled with the child's text or `label`. The
 * default is claimed from the server markup when the page hydrates.
 */
function buttonFor(child: unknown, label: string): HTMLElement {
  if (child instanceof HTMLElement) return child;
  const button = clientPlaceholder("button");
  button.type = "button";
  button.textContent = typeof child === "string" ? child : label;
  return button;
}

/**
 * A button that opens the sign-in dialog, or redirects to sign-in with `mode="redirect"`. A click before Clerk has
 * loaded does nothing; a failed call goes to the nearest `ErrorBoundary`.
 *
 * @param props See {@link AuthButtonProps}.
 * @returns The button element: the element child, or the default `<button>`. On the server, the default button's
 *   markup with its label and a hydration key (the browser claims it), or the element child as given.
 * @throws Error `SignInButton must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { SignInButton } from "@shadow-js/clerk";
 *
 * export function LogIn() {
 *   return (
 *     <SignInButton mode="modal" signInFallbackRedirectUrl="/dashboard">
 *       <button class="primary" type="button">
 *         Log in
 *       </button>
 *     </SignInButton>
 *   );
 * }
 * ```
 * @see {@link SignUpButton}
 * @since 1.0.0
 */
export function SignInButton(props: AuthButtonProps): unknown {
  const ctx = requireContext("SignInButton");
  const children = untrack(() => props.children);
  return actionButton(ctx, children, "Sign in", (clerk) => {
    const options = readOptions(props, ["children", "mode"]);
    return props.mode === "redirect" ? clerk.redirectToSignIn(options) : clerk.openSignIn(options);
  });
}

/**
 * A button that opens the sign-up dialog, or redirects to sign-up with `mode="redirect"`. A click before Clerk has
 * loaded does nothing; a failed call goes to the nearest `ErrorBoundary`.
 *
 * @param props See {@link AuthButtonProps}.
 * @returns The button element: the element child, or the default `<button>`. On the server, the default button's
 *   markup with its label and a hydration key (the browser claims it), or the element child as given.
 * @throws Error `SignUpButton must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { SignUpButton } from "@shadow-js/clerk";
 *
 * export function Join() {
 *   return (
 *     <SignUpButton mode="redirect" signUpForceRedirectUrl="/welcome">
 *       Create an account
 *     </SignUpButton>
 *   );
 * }
 * ```
 * @see {@link SignInButton}
 * @since 1.0.0
 */
export function SignUpButton(props: AuthButtonProps): unknown {
  const ctx = requireContext("SignUpButton");
  const children = untrack(() => props.children);
  return actionButton(ctx, children, "Sign up", (clerk) => {
    const options = readOptions(props, ["children", "mode"]);
    return props.mode === "redirect" ? clerk.redirectToSignUp(options) : clerk.openSignUp(options);
  });
}

/**
 * A button that signs the user out with `clerk.signOut()`. A click before Clerk has loaded does nothing; a failed
 * sign-out goes to the nearest `ErrorBoundary`.
 *
 * @param props See {@link SignOutButtonProps}.
 * @returns The button element: the element child, or the default `<button>`. On the server, the default button's
 *   markup with its label and a hydration key (the browser claims it), or the element child as given.
 * @throws Error `SignOutButton must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { SignedIn, SignOutButton } from "@shadow-js/clerk";
 *
 * export function AccountMenu() {
 *   return (
 *     <SignedIn>
 *       <SignOutButton redirectUrl="/">Log out</SignOutButton>
 *     </SignedIn>
 *   );
 * }
 * ```
 * @see {@link useAuth}
 * @since 1.0.0
 */
export function SignOutButton(props: SignOutButtonProps): unknown {
  const ctx = requireContext("SignOutButton");
  const children = untrack(() => props.children);
  return actionButton(ctx, children, "Sign out", (clerk) => clerk.signOut(signOutOptions(props)));
}

/** Copies only the sign-out options that were given, so no `undefined` keys reach Clerk. */
function signOutOptions(props: SignOutButtonProps): ClerkSignOutOptions {
  const options: { redirectUrl?: string; sessionId?: string } = {};
  if (props.redirectUrl !== undefined) options.redirectUrl = props.redirectUrl;
  if (props.sessionId !== undefined) options.sessionId = props.sessionId;
  return options;
}
