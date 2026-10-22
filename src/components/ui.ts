import type { ClerkUiOptions } from "../types";
import { mountClerkUi } from "./mount";

/**
 * Props of the mounted Clerk UI components. Every key except `children` is forwarded to Clerk's `mountX` call, and a
 * change of a prop mounts again with the new options. See {@link ClerkUiOptions} for the named keys.
 * @since 1.0.0
 */
export type ClerkUiProps = ClerkUiOptions;

/**
 * Mounts Clerk's sign-in form into a `<div>`. Props are forwarded to `clerk.mountSignIn()`. Clerk mounts into it once
 * it has loaded; a change of a prop mounts again on the same node, and removing the component unmounts it once.
 *
 * @param props See {@link ClerkUiProps}.
 * @returns The `<div>` that hosts the form. On the server, an empty `<div>` with a hydration key, which the browser
 *   claims; Clerk's markup is never rendered on the server.
 * @throws Error `SignIn must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { SignIn } from "@shadow-js/clerk";
 *
 * export function SignInPage() {
 *   return <SignIn path="/sign-in" routing="path" signUpUrl="/sign-up" />;
 * }
 * ```
 * @since 1.0.0
 */
export function SignIn(props: ClerkUiProps): unknown {
  return mountClerkUi("SignIn", props, {
    mount: (clerk, node, options) => clerk.mountSignIn(node, options),
    unmount: (clerk, node) => clerk.unmountSignIn(node),
  });
}

/**
 * Mounts Clerk's sign-up form into a `<div>`. Props are forwarded to `clerk.mountSignUp()`. Clerk mounts into it once
 * it has loaded; a change of a prop mounts again on the same node, and removing the component unmounts it once.
 *
 * @param props See {@link ClerkUiProps}.
 * @returns The `<div>` that hosts the form. On the server, an empty `<div>` with a hydration key, which the browser
 *   claims; Clerk's markup is never rendered on the server.
 * @throws Error `SignUp must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { SignUp } from "@shadow-js/clerk";
 *
 * export function SignUpPage() {
 *   return <SignUp path="/sign-up" routing="path" signInUrl="/sign-in" />;
 * }
 * ```
 * @since 1.0.0
 */
export function SignUp(props: ClerkUiProps): unknown {
  return mountClerkUi("SignUp", props, {
    mount: (clerk, node, options) => clerk.mountSignUp(node, options),
    unmount: (clerk, node) => clerk.unmountSignUp(node),
  });
}

/**
 * Mounts Clerk's user button (avatar and menu) into a `<div>`. Props are forwarded to `clerk.mountUserButton()`.
 * Clerk mounts into it once it has loaded; a change of a prop mounts again on the same node, and removing the
 * component unmounts it once.
 *
 * @param props See {@link ClerkUiProps}.
 * @returns The `<div>` that hosts the button. On the server, an empty `<div>` with a hydration key, which the browser
 *   claims; Clerk's markup is never rendered on the server.
 * @throws Error `UserButton must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { SignedIn, UserButton } from "@shadow-js/clerk";
 *
 * export function Header() {
 *   return (
 *     <header>
 *       <SignedIn>
 *         <UserButton />
 *       </SignedIn>
 *     </header>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function UserButton(props: ClerkUiProps): unknown {
  return mountClerkUi("UserButton", props, {
    mount: (clerk, node, options) => clerk.mountUserButton(node, options),
    unmount: (clerk, node) => clerk.unmountUserButton(node),
  });
}

/**
 * Mounts Clerk's user profile page into a `<div>`. Props are forwarded to `clerk.mountUserProfile()`. Clerk mounts
 * into it once it has loaded; a change of a prop mounts again on the same node, and removing the component unmounts
 * it once.
 *
 * @param props See {@link ClerkUiProps}.
 * @returns The `<div>` that hosts the profile. On the server, an empty `<div>` with a hydration key, which the
 *   browser claims; Clerk's markup is never rendered on the server.
 * @throws Error `UserProfile must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { UserProfile } from "@shadow-js/clerk";
 *
 * export function AccountPage() {
 *   return <UserProfile path="/account" routing="path" />;
 * }
 * ```
 * @since 1.0.0
 */
export function UserProfile(props: ClerkUiProps): unknown {
  return mountClerkUi("UserProfile", props, {
    mount: (clerk, node, options) => clerk.mountUserProfile(node, options),
    unmount: (clerk, node) => clerk.unmountUserProfile(node),
  });
}

/**
 * Mounts Clerk's organization switcher into a `<div>`. Props are forwarded to `clerk.mountOrganizationSwitcher()`.
 * Clerk mounts into it once it has loaded; a change of a prop mounts again on the same node, and removing the
 * component unmounts it once.
 *
 * @param props See {@link ClerkUiProps}.
 * @returns The `<div>` that hosts the switcher. On the server, an empty `<div>` with a hydration key, which the
 *   browser claims; Clerk's markup is never rendered on the server.
 * @throws Error `OrganizationSwitcher must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { OrganizationSwitcher } from "@shadow-js/clerk";
 *
 * export function OrganizationMenu() {
 *   return (
 *     <nav>
 *       <OrganizationSwitcher />
 *     </nav>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function OrganizationSwitcher(props: ClerkUiProps): unknown {
  return mountClerkUi("OrganizationSwitcher", props, {
    mount: (clerk, node, options) => clerk.mountOrganizationSwitcher(node, options),
    unmount: (clerk, node) => clerk.unmountOrganizationSwitcher(node),
  });
}

/**
 * Mounts Clerk's organization profile (members, settings, domains) into a `<div>`. Props are forwarded to
 * `clerk.mountOrganizationProfile()`. Clerk mounts into it once it has loaded; a change of a prop mounts again on the
 * same node, and removing the component unmounts it once.
 *
 * @param props See {@link ClerkUiProps}.
 * @returns The `<div>` that hosts the profile. On the server, an empty `<div>` with a hydration key, which the
 *   browser claims; Clerk's markup is never rendered on the server.
 * @throws Error `OrganizationProfile must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { OrganizationProfile } from "@shadow-js/clerk";
 *
 * export function OrganizationPage() {
 *   return <OrganizationProfile path="/organization" routing="path" />;
 * }
 * ```
 * @since 1.0.0
 */
export function OrganizationProfile(props: ClerkUiProps): unknown {
  return mountClerkUi("OrganizationProfile", props, {
    mount: (clerk, node, options) => clerk.mountOrganizationProfile(node, options),
    unmount: (clerk, node) => clerk.unmountOrganizationProfile(node),
  });
}

/**
 * Mounts Clerk's create-organization form into a `<div>`. Props are forwarded to `clerk.mountCreateOrganization()`.
 * Clerk mounts into it once it has loaded; a change of a prop mounts again on the same node, and removing the
 * component unmounts it once.
 *
 * @param props See {@link ClerkUiProps}.
 * @returns The `<div>` that hosts the form. On the server, an empty `<div>` with a hydration key, which the browser
 *   claims; Clerk's markup is never rendered on the server.
 * @throws Error `CreateOrganization must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { CreateOrganization } from "@shadow-js/clerk";
 *
 * export function NewOrganizationPage() {
 *   return <CreateOrganization afterCreateOrganizationUrl="/dashboard" />;
 * }
 * ```
 * @since 1.0.0
 */
export function CreateOrganization(props: ClerkUiProps): unknown {
  return mountClerkUi("CreateOrganization", props, {
    mount: (clerk, node, options) => clerk.mountCreateOrganization(node, options),
    unmount: (clerk, node) => clerk.unmountCreateOrganization(node),
  });
}

/**
 * Mounts Clerk's list of the user's organizations (with accept and create actions) into a `<div>`. Props are
 * forwarded to `clerk.mountOrganizationList()`. Clerk mounts into it once it has loaded; a change of a prop mounts
 * again on the same node, and removing the component unmounts it once.
 *
 * @param props See {@link ClerkUiProps}.
 * @returns The `<div>` that hosts the list. On the server, an empty `<div>` with a hydration key, which the browser
 *   claims; Clerk's markup is never rendered on the server.
 * @throws Error `OrganizationList must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { OrganizationList } from "@shadow-js/clerk";
 *
 * export function ChooseOrganizationPage() {
 *   return <OrganizationList hidePersonal afterSelectOrganizationUrl="/dashboard" />;
 * }
 * ```
 * @since 1.0.0
 */
export function OrganizationList(props: ClerkUiProps): unknown {
  return mountClerkUi("OrganizationList", props, {
    mount: (clerk, node, options) => clerk.mountOrganizationList(node, options),
    unmount: (clerk, node) => clerk.unmountOrganizationList(node),
  });
}
