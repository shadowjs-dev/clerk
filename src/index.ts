/**
 * `@shadow-js/clerk`: Clerk authentication for ShadowJS on the client. The provider loads Clerk (Clerk's own
 * browser bundles by default, or `@clerk/clerk-js` from the app bundle with `mode="bundled"`), the hooks return
 * accessors over the mirrored state, and the components
 * show or hide content by auth state and mount Clerk's UI. Server helpers live in `./server`.
 * @packageDocumentation
 */

export type { AuthButtonProps, SignOutButtonProps } from "./components/buttons";
export { SignInButton, SignOutButton, SignUpButton } from "./components/buttons";
export { AuthenticateWithRedirectCallback } from "./components/callback";
export type { GuardProps, ProtectProps } from "./components/guards";
export {
  AuthLoading,
  ClerkLoaded,
  ClerkLoading,
  Protect,
  RedirectToSignIn,
  RedirectToSignUp,
  SignedIn,
  SignedOut,
} from "./components/guards";
export type { PricingTableProps } from "./components/pricing-table";
export { PricingTable } from "./components/pricing-table";
export {
  HandleSSOCallback,
  type HandleSSOCallbackProps,
  type SsoOutcome,
} from "./components/sso-callback";
export type { ClerkUiProps } from "./components/ui";
export {
  CreateOrganization,
  OrganizationList,
  OrganizationProfile,
  OrganizationSwitcher,
  SignIn,
  SignUp,
  UserButton,
  UserProfile,
} from "./components/ui";
export type { WaitlistProps } from "./components/waitlist";
export { Waitlist } from "./components/waitlist";
export type { ClerkConvexAuthOptions, ConvexAuthState } from "./convex";
export { clerkConvexAuth } from "./convex";
export type {
  AuthState,
  OrganizationListState,
  OrganizationState,
  SessionState,
  SignInState,
  SignUpState,
  UserState,
} from "./hooks";
export {
  useAuth,
  useClerk,
  useOrganization,
  useOrganizationList,
  useReverification,
  useSession,
  useSignIn,
  useSignUp,
  useUser,
} from "./hooks";
export type { ClerkProviderMode, ClerkProviderProps } from "./provider";
export { ClerkProvider } from "./provider";
export type {
  ClerkAttemptLike,
  ClerkClientLike,
  ClerkConstructor,
  ClerkErrorLike,
  ClerkFactorLike,
  ClerkFetchStatus,
  ClerkFlowErrors,
  ClerkFlowResult,
  ClerkLike,
  ClerkListener,
  ClerkLoadOptions,
  ClerkMembershipLike,
  ClerkOrganizationLike,
  ClerkPricingTableOptions,
  ClerkRedirectOptions,
  ClerkResourcesLike,
  ClerkReverificationProps,
  ClerkSessionLike,
  ClerkSignInCreateParams,
  ClerkSignInEmailCode,
  ClerkSignInFuture,
  ClerkSignInSsoParams,
  ClerkSignInStatus,
  ClerkSignOutOptions,
  ClerkSignUpCreateParams,
  ClerkSignUpFuture,
  ClerkSignUpStatus,
  ClerkSignUpVerifications,
  ClerkTokenOptions,
  ClerkUiOptions,
  ClerkUserLike,
  ClerkVerificationLike,
  ClerkWaitlistOptions,
} from "./types";
