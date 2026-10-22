/**
 * Structural types of the Clerk integration. They describe only the members this package reads or
 * calls, so the real `Clerk` class from `@clerk/clerk-js` is assignable to {@link ClerkLike}, and
 * tests can inject a hand-written fake. Methods use method syntax on purpose: parameters are then
 * compared bivariantly, which lets the wider Clerk option types of the real SDK match.
 * @packageDocumentation
 */

/**
 * Options passed to `clerk.load()`. Clerk owns the vocabulary (`signInUrl`, `appearance`, ...), so
 * the package forwards them without reading them. The one key the provider touches is `ui`: in script and bundled
 * mode it adds Clerk's UI constructor as `ui.ClerkUI`, keeps any other `ui` keys you pass, and lets your own
 * `ui.ClerkUI` win.
 * @see {@link ClerkProviderProps}
 * @since 1.0.0
 */
export interface ClerkLoadOptions {
  /** Any option `clerk.load()` accepts, forwarded unchanged. */
  readonly [option: string]: unknown;
}

/**
 * Options shared by the mounted Clerk UI components (`SignIn`, `UserButton`, ...). Clerk owns the
 * vocabulary, so only the common keys are named; any other key is forwarded unchanged.
 * @see {@link ClerkUiProps}
 * @since 1.0.0
 */
export interface ClerkUiOptions {
  /** Clerk's `path` option: the path the component is mounted at, for `routing: "path"`. Forwarded unchanged. */
  readonly path?: string;
  /** Clerk's `routing` option: the routing strategy for the component's own steps. Forwarded unchanged. */
  readonly routing?: "path" | "hash" | "virtual";
  /** Clerk's `signInUrl` option: the path or URL of the sign-in page. Forwarded unchanged. */
  readonly signInUrl?: string;
  /** Clerk's `signUpUrl` option: the path or URL of the sign-up page. Forwarded unchanged. */
  readonly signUpUrl?: string;
  /** Clerk's `afterSignInUrl` option: where Clerk sends the user after a sign-in. Forwarded unchanged. */
  readonly afterSignInUrl?: string;
  /** Clerk's `afterSignUpUrl` option: where Clerk sends the user after a sign-up. Forwarded unchanged. */
  readonly afterSignUpUrl?: string;
  /** Clerk's `appearance` option (theme and style overrides). Forwarded unchanged; the package never reads it. */
  readonly appearance?: unknown;
  /** Any other option of the mounted component, forwarded unchanged. */
  readonly [option: string]: unknown;
}

/**
 * Options of Clerk's waitlist form (`clerk.mountWaitlist()`). Only the keys the waitlist documents are named; any other
 * key is forwarded unchanged.
 * @see {@link WaitlistProps}
 * @since 1.0.0
 */
export interface ClerkWaitlistOptions {
  /** Clerk's `afterJoinWaitlistUrl` option: where Clerk sends the visitor after joining the waitlist. Forwarded unchanged. */
  readonly afterJoinWaitlistUrl?: string;
  /** Clerk's `signInUrl` option: the path or URL of the sign-in page. Forwarded unchanged. */
  readonly signInUrl?: string;
  /** Clerk's `appearance` option (theme and style overrides). Forwarded unchanged; the package never reads it. */
  readonly appearance?: unknown;
  /** Any other option of the waitlist, forwarded unchanged. */
  readonly [option: string]: unknown;
}

/**
 * Options of Clerk's pricing table (`clerk.mountPricingTable()`). Only the keys the pricing table documents are named;
 * any other key is forwarded unchanged.
 * @see {@link PricingTableProps}
 * @since 1.0.0
 */
export interface ClerkPricingTableOptions {
  /** Clerk's `for` option: whose plans are shown, `"user"` (the default) or the active `"organization"`. Forwarded unchanged. */
  readonly for?: "user" | "organization";
  /** Clerk's `highlightedPlan` option: the slug of the plan with the "Popular" badge. Forwarded unchanged. */
  readonly highlightedPlan?: string;
  /** Clerk's `ctaPosition` option: where the call-to-action buttons sit. Forwarded unchanged. */
  readonly ctaPosition?: "top" | "bottom";
  /** Clerk's `collapseFeatures` option: whether the feature lists start collapsed. Forwarded unchanged. */
  readonly collapseFeatures?: boolean;
  /** Clerk's `newSubscriptionRedirectUrl` option: where Clerk sends the visitor after a new subscription. Forwarded unchanged. */
  readonly newSubscriptionRedirectUrl?: string;
  /** Clerk's `appearance` option (theme and style overrides). Forwarded unchanged; the package never reads it. */
  readonly appearance?: unknown;
  /** Any other option of the pricing table, forwarded unchanged. */
  readonly [option: string]: unknown;
}

/**
 * Redirect targets understood by `openSignIn`, `redirectToSignIn` and the sign-up counterparts. The
 * package forwards every key unchanged; Clerk decides what each one means.
 * @since 1.0.0
 */
export interface ClerkRedirectOptions {
  /** Clerk's `signInFallbackRedirectUrl`: where a sign-in ends when the URL names no other target. */
  readonly signInFallbackRedirectUrl?: string;
  /** Clerk's `signInForceRedirectUrl`: where a sign-in always ends. */
  readonly signInForceRedirectUrl?: string;
  /** Clerk's `signUpFallbackRedirectUrl`: where a sign-up ends when the URL names no other target. */
  readonly signUpFallbackRedirectUrl?: string;
  /** Clerk's `signUpForceRedirectUrl`: where a sign-up always ends. */
  readonly signUpForceRedirectUrl?: string;
  /** Clerk's `redirectUrl`: the page to return to after the flow. */
  readonly redirectUrl?: string;
  /** Any other redirect option Clerk accepts (for example `afterSignInUrl` of the redirect callback), forwarded unchanged. */
  readonly [option: string]: unknown;
}

/**
 * Options of `session.getToken()`. `template` names a JWT template from the Clerk dashboard.
 * @since 1.0.0
 */
export interface ClerkTokenOptions {
  /** The JWT template to sign the token with. Without it, the token is the session token. */
  readonly template?: string;
  /** `true` asks Clerk for a new token instead of a cached one (what {@link clerkConvexAuth} sends for a forced refresh). */
  readonly skipCache?: boolean;
}

/**
 * Options of `clerk.signOut()`.
 * @since 1.0.0
 */
export interface ClerkSignOutOptions {
  /** The session to end, in a multi-session app. Without it, Clerk ends the sessions of this browser. */
  readonly sessionId?: string;
  /** Where Clerk navigates once the user is signed out. */
  readonly redirectUrl?: string;
}

/**
 * The organization membership of the signed-in user, as far as this package reads it.
 * @since 1.0.0
 */
export interface ClerkMembershipLike {
  /** The user's role in the organization, for example `"org:admin"`. {@link Protect} compares it exactly. */
  readonly role: string;
  /** The user's permissions in the organization. Missing reads as no permissions. */
  readonly permissions?: readonly string[] | undefined;
  /** The organization of this membership; only its `id` is read. */
  readonly organization: { readonly id: string };
}

/**
 * The signed-in user, as far as this package reads it.
 * @since 1.0.0
 */
export interface ClerkUserLike {
  /** The user's id (`user_...`). */
  readonly id: string;
  /** The user's organization memberships. Missing reads as none. */
  readonly organizationMemberships?: readonly ClerkMembershipLike[] | undefined;
}

/**
 * A Clerk session. `status` is `"active"` only for a usable, signed-in session.
 * @since 1.0.0
 */
export interface ClerkSessionLike {
  /** The session's id (`sess_...`). */
  readonly id: string;
  /** Clerk's session status. Only `"active"` counts as signed in; any other value, `"pending"` included, is signed out. */
  readonly status: string;
  /** The organization this session was last used with (set by `setActive({ organization })` in any tab). */
  readonly lastActiveOrganizationId?: string | null | undefined;
  /**
   * Resolves a token for this session (see {@link ClerkTokenOptions}), or `null` when Clerk has none.
   * @param options The JWT template and whether to skip Clerk's cache.
   */
  getToken(options?: ClerkTokenOptions): Promise<string | null>;
}

/**
 * The active organization.
 * @since 1.0.0
 */
export interface ClerkOrganizationLike {
  /** The organization's id (`org_...`). */
  readonly id: string;
}

/**
 * The sign-in or sign-up attempt of the `client` resource. Only its status is read.
 * @since 1.0.0
 */
export interface ClerkAttemptLike {
  /** Clerk's status of the attempt, such as `"complete"` or `"needs_second_factor"`, or `null` before one exists. */
  readonly status: string | null;
  /** The sign-in can be moved to a sign-up (clerk-js sets it for an SSO attempt that needs one). */
  readonly isTransferable?: boolean | undefined;
}

/**
 * The Clerk client resource. Hosts the in-progress sign-in and sign-up attempts.
 * @since 1.0.0
 */
export interface ClerkClientLike {
  /** The in-progress sign-in attempt, read by {@link HandleSSOCallback}. */
  readonly signIn?: ClerkAttemptLike | undefined;
  /** The in-progress sign-up attempt, read by {@link HandleSSOCallback}. */
  readonly signUp?: ClerkAttemptLike | undefined;
  /** The session the user last used in this browser (set by a sign-in in any tab). */
  readonly lastActiveSessionId?: string | null | undefined;
  /** Sessions of this browser that are signed in. */
  readonly signedInSessions?: readonly { readonly id: string }[] | undefined;
  /** Reloads this client from Clerk (resources of the browser, including sessions made in other tabs). */
  reload?(): Promise<unknown>;
}

/**
 * The resources Clerk emits to a listener. Missing keys mean "not known yet".
 * @since 1.0.0
 */
export interface ClerkResourcesLike {
  /** The client resource, `undefined` until Clerk has loaded it. */
  readonly client?: ClerkClientLike | undefined;
  /** The active session, `null` when signed out, `undefined` while unknown. */
  readonly session?: ClerkSessionLike | null | undefined;
  /** The signed-in user, `null` when signed out, `undefined` while unknown. */
  readonly user?: ClerkUserLike | null | undefined;
  /** The active organization, `null` when there is none, `undefined` while unknown. */
  readonly organization?: ClerkOrganizationLike | null | undefined;
}

/**
 * Called by Clerk each time a resource changes. The provider applies each call in one batch.
 * @since 1.0.0
 */
export type ClerkListener = (resources: ClerkResourcesLike) => void;

/**
 * Minimal view of the Clerk instance used by the package. Implemented by the real `Clerk` class
 * (type-checked in the test suite) and by the fake the tests inject. {@link useClerk} returns it once loaded.
 * @since 1.0.0
 */
export interface ClerkLike {
  /** True once `load()` has finished. The provider hands the instance out only then. */
  readonly loaded: boolean;
  /** The client resource, `undefined` before load. */
  readonly client: ClerkClientLike | undefined;
  /** The signed-in user, `null` when signed out, `undefined` before load. */
  readonly user: ClerkUserLike | null | undefined;
  /** The active session, `null` when signed out, `undefined` before load. */
  readonly session: ClerkSessionLike | null | undefined;
  /** The active organization, `null` when there is none, `undefined` before load. */
  readonly organization: ClerkOrganizationLike | null | undefined;
  /** Loads Clerk with the given options (see {@link ClerkLoadOptions}). The provider calls it once per instance. */
  load(options?: object): Promise<void>;
  /** Subscribes to resource changes and returns the function that ends the subscription. */
  addListener(listener: ClerkListener, options?: { skipInitialEmit?: boolean }): () => void;
  /** Signs out (see {@link ClerkSignOutOptions}). */
  signOut(options?: ClerkSignOutOptions | undefined): Promise<void>;
  /** Opens Clerk's sign-in dialog. Called by {@link SignInButton} in modal mode. */
  openSignIn(options?: object): void;
  /** Opens Clerk's sign-up dialog. Called by {@link SignUpButton} in modal mode. */
  openSignUp(options?: object): void;
  /** Navigates to the sign-in page. Called by {@link RedirectToSignIn} and by {@link SignInButton} in redirect mode. */
  redirectToSignIn(options?: object): Promise<unknown>;
  /** Navigates to the sign-up page. Called by {@link RedirectToSignUp} and by {@link SignUpButton} in redirect mode. */
  redirectToSignUp(options?: object): Promise<unknown>;
  /** Makes a session and organization the active ones (`null` for none). */
  setActive(params: { session?: string | null; organization?: string | null }): Promise<void>;
  /** Mounts Clerk's sign-in form into `node`. Called by {@link SignIn}. */
  mountSignIn(node: HTMLDivElement, options?: object): void;
  /** Unmounts the sign-in form from `node`. */
  unmountSignIn(node: HTMLDivElement): void;
  /** Mounts Clerk's sign-up form into `node`. Called by {@link SignUp}. */
  mountSignUp(node: HTMLDivElement, options?: object): void;
  /** Unmounts the sign-up form from `node`. */
  unmountSignUp(node: HTMLDivElement): void;
  /** Mounts Clerk's user button into `node`. Called by {@link UserButton}. */
  mountUserButton(node: HTMLDivElement, options?: object): void;
  /** Unmounts the user button from `node`. */
  unmountUserButton(node: HTMLDivElement): void;
  /** Mounts Clerk's user profile into `node`. Called by {@link UserProfile}. */
  mountUserProfile(node: HTMLDivElement, options?: object): void;
  /** Unmounts the user profile from `node`. */
  unmountUserProfile(node: HTMLDivElement): void;
  /** Mounts Clerk's organization switcher into `node`. Called by {@link OrganizationSwitcher}. */
  mountOrganizationSwitcher(node: HTMLDivElement, options?: object): void;
  /** Unmounts the organization switcher from `node`. */
  unmountOrganizationSwitcher(node: HTMLDivElement): void;
  /** Mounts Clerk's organization profile into `node`. Called by {@link OrganizationProfile}. */
  mountOrganizationProfile(node: HTMLDivElement, options?: object): void;
  /** Unmounts the organization profile from `node`. */
  unmountOrganizationProfile(node: HTMLDivElement): void;
  /** Mounts Clerk's create-organization form into `node`. Called by {@link CreateOrganization}. */
  mountCreateOrganization(node: HTMLDivElement, options?: object): void;
  /** Unmounts the create-organization form from `node`. */
  unmountCreateOrganization(node: HTMLDivElement): void;
  /** Mounts Clerk's organization list into `node`. Called by {@link OrganizationList}. */
  mountOrganizationList(node: HTMLDivElement, options?: object): void;
  /** Unmounts the organization list from `node`. */
  unmountOrganizationList(node: HTMLDivElement): void;
  /** Mounts Clerk's waitlist form into `node`. Called by {@link Waitlist}. */
  mountWaitlist(node: HTMLDivElement, options?: object): void;
  /** Unmounts the waitlist form from `node`. */
  unmountWaitlist(node: HTMLDivElement): void;
  /** Mounts Clerk's pricing table into `node`. Called by {@link PricingTable}. */
  mountPricingTable(node: HTMLDivElement, options?: object): void;
  /** Unmounts the pricing table from `node`. */
  unmountPricingTable(node: HTMLDivElement): void;
  /** Completes an OAuth or SSO redirect: called by `AuthenticateWithRedirectCallback`. */
  handleRedirectCallback(
    params?: object,
    customNavigate?: (to: string) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * What the verification dialog is asked for: the level the server requires (when it names one), and the two
 * outcomes it reports back. {@link useReverification} builds it.
 * @since 1.0.0
 */
export interface ClerkReverificationProps {
  /** Omitted when the server did not name a level. Matches clerk-js's `SessionVerificationLevel`. */
  readonly level?: "first_factor" | "second_factor" | "multi_factor";
  /** Called once the visitor has verified; the wrapped action then runs again. */
  readonly afterVerification: () => void;
  /** Called when the visitor closes the dialog; the wrapped action rejects with `reverification_cancelled`. */
  readonly afterVerificationCancelled: () => void;
}

/**
 * Constructor of the Clerk class. The lazily imported `@clerk/clerk-js` exports one; the provider calls it with the
 * publishable key in bundled mode.
 * @since 1.0.0
 */
export type ClerkConstructor = new (publishableKey: string) => ClerkLike;

/**
 * An error of a flow call, as far as this package reads it. clerk-js's `ClerkError` has these fields.
 * @since 1.0.0
 */
export interface ClerkErrorLike {
  /** A short description of the error. */
  readonly message: string;
  /** Clerk's error code, for example `form_identifier_not_found`, when Clerk gives one. */
  readonly code?: string | undefined;
  /** A longer description meant for the user, when Clerk gives one. */
  readonly longMessage?: string | undefined;
}

/**
 * What a flow method resolves to. `error` is `null` when the step succeeded.
 * @since 1.0.0
 */
export interface ClerkFlowResult {
  /** The error of the step, or `null` when it succeeded. Read the next step from the resource's `status`. */
  readonly error: ClerkErrorLike | null;
}

/**
 * The errors of the last fetch of a sign-in or sign-up: per field, the raw API errors, and the errors that belong to no
 * field. Mirrors clerk-js's `errors` signal. Before Clerk has loaded, and when clerk-js sends none, it is
 * `{ fields: {}, raw: null, global: null }`.
 * @since 1.0.0
 */
export interface ClerkFlowErrors {
  /** The error of each form field, keyed by Clerk's field name (for example `identifier`). `{}` when there are none. */
  readonly fields: Readonly<Record<string, ClerkErrorLike | null | undefined>>;
  /** The API errors as clerk-js received them, or `null`. */
  readonly raw: readonly unknown[] | null;
  /** The errors that belong to no field, or `null`. */
  readonly global: readonly ClerkErrorLike[] | null;
}

/**
 * Whether the flow resource is being fetched by clerk-js: `"fetching"` while a request runs, otherwise `"idle"`.
 * @since 1.0.0
 */
export type ClerkFetchStatus = "idle" | "fetching";

/**
 * A step of a sign-in or sign-up that carries a verification, for example the email code of the first factor.
 * @since 1.0.0
 */
export interface ClerkVerificationLike {
  /** Clerk's verification status (for example `"unverified"` or `"verified"`), or `null` before one started. */
  readonly status: string | null;
  /** The strategy being verified, such as `email_code`, or `null`. */
  readonly strategy?: string | null | undefined;
  /** How many attempts were made, as Clerk reports it, or `null`. */
  readonly attempts?: number | null | undefined;
  /** The error of the last attempt, or `null`. */
  readonly error?: ClerkErrorLike | null | undefined;
}

/**
 * A first or second factor a sign-in supports (`strategy` is the Clerk name, such as `email_code` or `oauth_google`).
 * @since 1.0.0
 */
export interface ClerkFactorLike {
  /** The Clerk name of the factor, such as `email_code`, `password`, `totp` or `oauth_google`. */
  readonly strategy: string;
}

/**
 * The statuses of a sign-in (clerk-js's `SignInFutureResource.status`): `complete` once a session was created (call
 * `finalize()`), otherwise the `needs_*` step the sign-in waits for. A status this list does not name is still a
 * string.
 * @since 1.0.0
 */
export type ClerkSignInStatus =
  | "complete"
  | "needs_identifier"
  | "needs_first_factor"
  | "needs_second_factor"
  | "needs_client_trust"
  | "needs_new_password"
  | "needs_protect_check"
  | (string & {});

/**
 * The statuses of a sign-up: `complete` once the user was created, `missing_requirements` while fields are missing or
 * unverified, `abandoned` for an attempt Clerk gave up. A status this list does not name is still a string.
 * @since 1.0.0
 */
export type ClerkSignUpStatus = "complete" | "missing_requirements" | "abandoned" | (string & {});

/**
 * Parameters of `signIn.create()`. Every field is optional; Clerk checks which ones the instance needs. Each field is
 * forwarded to Clerk unchanged.
 * @since 1.0.0
 */
export interface ClerkSignInCreateParams {
  /** The email address, phone number or username the user signs in with. */
  readonly identifier?: string | undefined;
  /** The password, for a password sign-in in one step. */
  readonly password?: string | undefined;
  /** The first-factor strategy, such as `email_code` or `oauth_google`. */
  readonly strategy?: string | undefined;
  /** For a redirect strategy, where Clerk sends the browser back. */
  readonly redirectUrl?: string | undefined;
  /** For a redirect strategy, where the browser goes once the flow has completed. */
  readonly actionCompleteRedirectUrl?: string | undefined;
  /** Clerk's `timezone` parameter. */
  readonly timezone?: string | undefined;
  /** `true` moves a transferable sign-up to a sign-in (see `isTransferable`). */
  readonly transfer?: boolean | undefined;
  /** A Clerk ticket, for the ticket strategy (for example an invitation). */
  readonly ticket?: string | undefined;
  /** Clerk's `signUpIfMissing` parameter. */
  readonly signUpIfMissing?: boolean | undefined;
}

/**
 * Parameters of `signIn.sso()`: the redirect that starts an OAuth or enterprise SSO sign-in.
 * @since 1.0.0
 */
export interface ClerkSignInSsoParams {
  /** The strategy, such as `oauth_google`, `oauth_github` or `enterprise_sso`. */
  readonly strategy: string;
  /** Where Clerk sends the visitor after the provider, when the sign-in completes. */
  readonly redirectUrl: string;
  /** Where Clerk sends the visitor when the sign-in needs another step, usually a route with `<HandleSSOCallback />`. */
  readonly redirectCallbackUrl: string;
  /** A window for Clerk to run the provider in, instead of navigating this page. */
  readonly popup?: Window | undefined;
  /** Clerk's `oidcPrompt` parameter, forwarded to the provider. */
  readonly oidcPrompt?: string | undefined;
  /** The enterprise connection to use, for enterprise SSO. */
  readonly enterpriseConnectionId?: string | undefined;
  /** The identifier (for example an email address) Clerk starts the sign-in with. */
  readonly identifier?: string | undefined;
}

/**
 * The email-code methods of a sign-in.
 * @since 1.0.0
 */
export interface ClerkSignInEmailCode {
  /** Sends a one-time code to the email address of the sign-in, or to the address given by value or by id. */
  sendCode(params?: {
    /** The address to send the code to. */
    readonly emailAddress?: string;
    /** Clerk's id of the address to send the code to. */
    readonly emailAddressId?: string;
  }): Promise<ClerkFlowResult>;
  /** Checks the code the user typed. On success the sign-in moves on (read `status`). */
  verifyCode(params: {
    /** The code the user typed. */
    readonly code: string;
  }): Promise<ClerkFlowResult>;
}

/**
 * The in-progress sign-in of clerk-js's future API (`useSignIn().signIn()`). Methods return `{ error }`; read the
 * result
 * from `status`, and the errors from the `errors` accessor of the hook. Reset, SSO and the factor methods are the
 * ones a
 * custom flow uses. Method syntax on purpose: parameters are compared bivariantly, so the wider Clerk parameter types
 * still match. It is clerk-js's own object: call its methods on it, do not copy them out.
 * @see {@link useSignIn}
 * @since 1.0.0
 */
export interface ClerkSignInFuture {
  /** The attempt's id, once Clerk has created it. */
  readonly id?: string | undefined;
  /** The step the sign-in is at. See {@link ClerkSignInStatus}. */
  readonly status: ClerkSignInStatus;
  /** The identifier the sign-in was started with, or `null`. */
  readonly identifier: string | null;
  /** The id of the session the completed sign-in created, or `null`. */
  readonly createdSessionId: string | null;
  /** True when Clerk can move this sign-in to a sign-up (an SSO account that does not exist yet). */
  readonly isTransferable: boolean;
  /** Clerk's `timezone` of the attempt. */
  readonly timezone?: string | null | undefined;
  /** The existing session Clerk reports for this attempt, with its id. */
  readonly existingSession?: { readonly sessionId: string } | undefined;
  /** The first factors this sign-in can use. */
  readonly supportedFirstFactors: readonly ClerkFactorLike[];
  /** The second factors this sign-in can use. */
  readonly supportedSecondFactors: readonly ClerkFactorLike[];
  /** The state of the first-factor verification. */
  readonly firstFactorVerification: ClerkVerificationLike;
  /** The state of the second-factor verification. */
  readonly secondFactorVerification: ClerkVerificationLike;
  /** Clerk's `canBeDiscarded` flag of the attempt. */
  readonly canBeDiscarded?: boolean | undefined;
  /** Clears the local state of this attempt, so the flow can start again (no API call). The status changes and the hook's accessors update. */
  reset(): Promise<ClerkFlowResult>;
  /** Creates the attempt, for example with the identifier. See {@link ClerkSignInCreateParams}. */
  create(params: ClerkSignInCreateParams): Promise<ClerkFlowResult>;
  /** Signs in with a password, optionally naming the identifier in the same call. */
  password(params: {
    /** The password the user typed. */
    readonly password: string;
    /** The identifier, when the attempt was not created with one. */
    readonly identifier?: string;
    /** The email address to sign in with. */
    readonly emailAddress?: string;
    /** The phone number to sign in with. */
    readonly phoneNumber?: string;
    /** Clerk's `timezone` parameter. */
    readonly timezone?: string;
  }): Promise<ClerkFlowResult>;
  /** The email-code factor. See {@link ClerkSignInEmailCode}. */
  readonly emailCode: ClerkSignInEmailCode;
  /**
   * The password-reset factor: a forgotten password is reset with a code sent to the account's email address, then a
   * new password. The steps are `sendCode`, `verifyCode` (the status becomes `needs_new_password`) and `submitPassword`
   * (the status becomes `complete`). See {@link ClerkSignInFuture.reset} to start over without a request.
   */
  readonly resetPasswordEmailCode: {
    /** Sends a password reset code to the first email address on the account. */
    sendCode(): Promise<ClerkFlowResult>;
    /** Checks the reset code the user typed. On success the status is `needs_new_password`. */
    verifyCode(params: {
      /** The code the user typed. */
      readonly code: string;
    }): Promise<ClerkFlowResult>;
    /** Sets the new password. On success the sign-in is `complete` (read `status`), then call `finalize()` or `setActive`. */
    submitPassword(params: {
      /** The new password the user typed. */
      readonly password: string;
      /** `true` signs the user out of their other sessions. */
      readonly signOutOfOtherSessions?: boolean;
    }): Promise<ClerkFlowResult>;
  };
  /** The email-link factor. */
  readonly emailLink: {
    /** Sends a sign-in link that leads to `verificationUrl`. */
    sendLink(params: {
      /** The page of this app the link opens. */
      readonly verificationUrl: string;
      /** The address to send the link to. */
      readonly emailAddress?: string;
      /** Clerk's id of the address to send the link to. */
      readonly emailAddressId?: string;
    }): Promise<ClerkFlowResult>;
    /** Resolves once the link was opened (or the wait failed). */
    waitForVerification(): Promise<ClerkFlowResult>;
    /** The result of the link verification, or `null` before there is one. */
    readonly verification: {
      /** Clerk's status of the link verification. */
      readonly status: string;
      /** The id of the session the verification created. */
      readonly createdSessionId: string;
      /** True when the link was opened in this browser. */
      readonly verifiedFromTheSameClient: boolean;
    } | null;
  };
  /** The phone-code factor. */
  readonly phoneCode: {
    /** Sends a one-time code to the phone number of the sign-in, or to the number given by value or by id. */
    sendCode(params?: {
      /** Clerk's delivery channel, such as `sms`. */
      readonly channel?: string;
      /** The number to send the code to. */
      readonly phoneNumber?: string;
      /** Clerk's id of the number to send the code to. */
      readonly phoneNumberId?: string;
    }): Promise<ClerkFlowResult>;
    /** Checks the code the user typed. */
    verifyCode(params: {
      /** The code the user typed. */
      readonly code: string;
    }): Promise<ClerkFlowResult>;
  };
  /** Starts an OAuth (`oauth_google` ...) or enterprise SSO sign-in: the browser is sent to the provider. */
  sso(params: ClerkSignInSsoParams): Promise<ClerkFlowResult>;
  /** The second-factor methods, for a sign-in at `needs_second_factor`. */
  readonly mfa: {
    /** Sends a code to the user's phone. */
    sendPhoneCode(): Promise<ClerkFlowResult>;
    /** Checks the phone code. */
    verifyPhoneCode(params: {
      /** The code the user typed. */
      readonly code: string;
    }): Promise<ClerkFlowResult>;
    /** Sends a code to the user's email address. */
    sendEmailCode(): Promise<ClerkFlowResult>;
    /** Checks the email code. */
    verifyEmailCode(params: {
      /** The code the user typed. */
      readonly code: string;
    }): Promise<ClerkFlowResult>;
    /** Checks a code of the user's authenticator app. */
    verifyTOTP(params: {
      /** The code the user typed. */
      readonly code: string;
    }): Promise<ClerkFlowResult>;
    /** Checks one of the user's backup codes. */
    verifyBackupCode(params: {
      /** The code the user typed. */
      readonly code: string;
    }): Promise<ClerkFlowResult>;
  };
  /** Signs in with a Clerk ticket (for example from an invitation). */
  ticket(params?: {
    /** The ticket. */
    readonly ticket: string;
  }): Promise<ClerkFlowResult>;
  /** Signs in with a Web3 wallet. */
  web3(params: {
    /** The Web3 strategy, such as `web3_metamask_signature`. */
    readonly strategy: string;
    /** The wallet provider. */
    readonly provider: string;
    /** The wallet's name, when the provider needs one. */
    readonly walletName?: string;
  }): Promise<ClerkFlowResult>;
  /** Signs in with a passkey. */
  passkey(params?: {
    /** `"autofill"` for the browser's passkey autofill, `"discoverable"` for the passkey picker. */
    readonly flow?: "autofill" | "discoverable";
  }): Promise<ClerkFlowResult>;
  /** Answers Clerk's protect check, for a sign-in at `needs_protect_check`. */
  submitProtectCheck(params: {
    /** The proof token of the check. */
    readonly proofToken: string;
  }): Promise<ClerkFlowResult>;
  /** Makes the completed sign-in's session the active one. `navigate` runs before the redirect, with the URL decorator. */
  finalize(params?: {
    /** Performs the navigation. Pass the destination through `decorateUrl` before navigating to it. */
    readonly navigate?: (params: {
      /** Adds what Clerk needs to the destination URL. */
      readonly decorateUrl: (url: string) => string;
    }) => void | Promise<void>;
  }): Promise<ClerkFlowResult>;
}

/**
 * Parameters of `signUp.create()`. Every field is optional and forwarded to Clerk unchanged.
 * @since 1.0.0
 */
export interface ClerkSignUpCreateParams {
  /** The user's first name. */
  readonly firstName?: string | undefined;
  /** The user's last name. */
  readonly lastName?: string | undefined;
  /** The user's email address. */
  readonly emailAddress?: string | undefined;
  /** The user's phone number. */
  readonly phoneNumber?: string | undefined;
  /** The user's username. */
  readonly username?: string | undefined;
  /** The user's password. */
  readonly password?: string | undefined;
  /** The sign-up strategy, such as `oauth_google` or `ticket`. */
  readonly strategy?: string | undefined;
  /** For a redirect strategy, where Clerk sends the browser back. */
  readonly redirectUrl?: string | undefined;
  /** Whether the user accepted the legal terms, when the instance requires it. */
  readonly legalAccepted?: boolean | undefined;
  /** Metadata stored on the new user. The browser writes it, so the server must not trust it. */
  readonly unsafeMetadata?: Readonly<Record<string, unknown>> | undefined;
  /** Clerk's `locale` parameter, such as `"en-US"`. */
  readonly locale?: string | undefined;
  /** Clerk's `timezone` parameter. */
  readonly timezone?: string | undefined;
  /** `true` moves a transferable sign-in (an SSO account that does not exist yet) to this sign-up. */
  readonly transfer?: boolean | undefined;
  /** A Clerk ticket, for the ticket strategy (for example an invitation). */
  readonly ticket?: string | undefined;
}

/**
 * The verifications of a sign-up: the state of each contact field, and the methods that verify it.
 * @since 1.0.0
 */
export interface ClerkSignUpVerifications {
  /** The verification of the email address. */
  readonly emailAddress: ClerkVerificationLike;
  /** The verification of the phone number. */
  readonly phoneNumber: ClerkVerificationLike;
  /** The verification of the Web3 wallet. */
  readonly web3Wallet: ClerkVerificationLike;
  /** The verification of the external (OAuth) account. */
  readonly externalAccount: ClerkVerificationLike;
  /** The result of the email-link verification, or `null` before there is one. */
  readonly emailLinkVerification: {
    /** Clerk's status of the link verification. */
    readonly status: string;
    /** The id of the session the verification created. */
    readonly createdSessionId: string;
    /** True when the link was opened in this browser. */
    readonly verifiedFromTheSameClient: boolean;
  } | null;
  /** Sends a code to the sign-up's email address. */
  sendEmailCode(): Promise<ClerkFlowResult>;
  /** Checks the email code. */
  verifyEmailCode(params: {
    /** The code the user typed. */
    readonly code: string;
  }): Promise<ClerkFlowResult>;
  /** Sends a verification link that leads to `verificationUrl`. */
  sendEmailLink(params: {
    /** The page of this app the link opens. */
    readonly verificationUrl: string;
  }): Promise<ClerkFlowResult>;
  /** Resolves once the link was opened (or the wait failed). */
  waitForEmailLinkVerification(): Promise<ClerkFlowResult>;
  /** Sends a code to the sign-up's phone number. */
  sendPhoneCode(params?: {
    /** Clerk's delivery channel, such as `sms`. */
    readonly channel?: string;
  }): Promise<ClerkFlowResult>;
  /** Checks the phone code. */
  verifyPhoneCode(params: {
    /** The code the user typed. */
    readonly code: string;
  }): Promise<ClerkFlowResult>;
}

/**
 * The in-progress sign-up of clerk-js's future API (`useSignUp().signUp()`). See {@link ClerkSignInFuture} for the
 * conventions.
 * @see {@link useSignUp}
 * @since 1.0.0
 */
export interface ClerkSignUpFuture {
  /** The attempt's id, once Clerk has created it. */
  readonly id?: string | undefined;
  /** The step the sign-up is at. See {@link ClerkSignUpStatus}. */
  readonly status: ClerkSignUpStatus;
  /** The fields the instance requires. */
  readonly requiredFields: readonly string[];
  /** The fields the instance accepts but does not require. */
  readonly optionalFields: readonly string[];
  /** The required fields that have no value yet. */
  readonly missingFields: readonly string[];
  /** The fields that have a value that is not verified yet. */
  readonly unverifiedFields: readonly string[];
  /** True when Clerk can move this sign-up to a sign-in. */
  readonly isTransferable: boolean;
  /** The existing session Clerk reports for this attempt, with its id. */
  readonly existingSession?: { readonly sessionId: string } | undefined;
  /** The username given so far, or `null`. */
  readonly username: string | null;
  /** The first name given so far, or `null`. */
  readonly firstName: string | null;
  /** The last name given so far, or `null`. */
  readonly lastName: string | null;
  /** The email address given so far, or `null`. */
  readonly emailAddress: string | null;
  /** The phone number given so far, or `null`. */
  readonly phoneNumber: string | null;
  /** The Web3 wallet given so far, or `null`. */
  readonly web3Wallet: string | null;
  /** True when a password was set. */
  readonly hasPassword: boolean;
  /** The metadata written by the browser (see {@link ClerkSignUpCreateParams.unsafeMetadata}). */
  readonly unsafeMetadata: Readonly<Record<string, unknown>>;
  /** The id of the session the completed sign-up created, or `null`. */
  readonly createdSessionId: string | null;
  /** The id of the user the completed sign-up created, or `null`. */
  readonly createdUserId: string | null;
  /** Clerk's `abandonAt` timestamp of the attempt, or `null`. */
  readonly abandonAt: number | null;
  /** Clerk's timestamp of the legal acceptance, or `null`. */
  readonly legalAcceptedAt: number | null;
  /** Clerk's `locale` of the attempt, or `null`. */
  readonly locale: string | null;
  /** Clerk's `timezone` of the attempt, or `null`. */
  readonly timezone: string | null;
  /** Clerk's `canBeDiscarded` flag of the attempt. */
  readonly canBeDiscarded?: boolean | undefined;
  /** The verification state and methods of the contact fields. See {@link ClerkSignUpVerifications}. */
  readonly verifications: ClerkSignUpVerifications;
  /** Clears the local state of this attempt, so the flow can start again (no API call). */
  reset(): Promise<ClerkFlowResult>;
  /** Creates the attempt. See {@link ClerkSignUpCreateParams}. */
  create(params: ClerkSignUpCreateParams): Promise<ClerkFlowResult>;
  /** Updates fields of the attempt; each field has the meaning it has in {@link ClerkSignUpCreateParams}. */
  update(params: {
    /** The user's first name. */
    readonly firstName?: string;
    /** The user's last name. */
    readonly lastName?: string;
    /** The user's email address. */
    readonly emailAddress?: string;
    /** The user's phone number. */
    readonly phoneNumber?: string;
    /** The user's username. */
    readonly username?: string;
    /** Metadata stored on the new user, written by the browser. */
    readonly unsafeMetadata?: Readonly<Record<string, unknown>>;
    /** Whether the user accepted the legal terms. */
    readonly legalAccepted?: boolean;
    /** Clerk's `locale` parameter. */
    readonly locale?: string;
  }): Promise<ClerkFlowResult>;
  /** Signs up with a password and, optionally, the other fields in the same call. */
  password(params: {
    /** The password. */
    readonly password: string;
    /** The user's email address. */
    readonly emailAddress?: string;
    /** The user's phone number. */
    readonly phoneNumber?: string;
    /** The user's username. */
    readonly username?: string;
    /** The user's first name. */
    readonly firstName?: string;
    /** The user's last name. */
    readonly lastName?: string;
    /** Whether the user accepted the legal terms. */
    readonly legalAccepted?: boolean;
  }): Promise<ClerkFlowResult>;
  /** Starts an OAuth or enterprise SSO sign-up: the browser is sent to the provider. The fields mean what they mean in {@link ClerkSignInSsoParams}. */
  sso(params: {
    /** The strategy, such as `oauth_google`. */
    readonly strategy: string;
    /** Where Clerk sends the visitor after the provider, when the sign-up completes. */
    readonly redirectUrl: string;
    /** Where Clerk sends the visitor when the sign-up needs another step. */
    readonly redirectCallbackUrl: string;
    /** A window for Clerk to run the provider in, instead of navigating this page. */
    readonly popup?: Window | undefined;
    /** Clerk's `oidcPrompt` parameter, forwarded to the provider. */
    readonly oidcPrompt?: string | undefined;
    /** The enterprise connection to use, for enterprise SSO. */
    readonly enterpriseConnectionId?: string | undefined;
    /** The email address Clerk starts the sign-up with. */
    readonly emailAddress?: string | undefined;
  }): Promise<ClerkFlowResult>;
  /** Signs up with a Clerk ticket (for example from an invitation). */
  ticket(params?: {
    /** The ticket. */
    readonly ticket: string;
  }): Promise<ClerkFlowResult>;
  /** Signs up with a Web3 wallet. */
  web3(params: {
    /** The Web3 strategy, such as `web3_metamask_signature`. */
    readonly strategy: string;
  }): Promise<ClerkFlowResult>;
  /** Answers Clerk's protect check. */
  submitProtectCheck(params: {
    /** The proof token of the check. */
    readonly proofToken: string;
  }): Promise<ClerkFlowResult>;
  /** Makes the completed sign-up's session the active one. `navigate` runs before the redirect, with the URL decorator. */
  finalize(params?: {
    /** Performs the navigation. Pass the destination through `decorateUrl` before navigating to it. */
    readonly navigate?: (params: {
      /** Adds what Clerk needs to the destination URL. */
      readonly decorateUrl: (url: string) => string;
    }) => void | Promise<void>;
  }): Promise<ClerkFlowResult>;
}

/**
 * The mirrored state of one flow (sign-in or sign-up) as the provider holds it: the resource, its errors, and the fetch
 * status. `resource` is `null` before Clerk has one, or when clerk-js's resource lacks the future methods.
 * @internal
 */
export interface ClerkFlowSnapshot<R> {
  /** The future resource, or `null`. */
  readonly resource: R | null;
  /** The errors of the last fetch. */
  readonly errors: ClerkFlowErrors;
  /** Whether clerk-js is fetching the resource. */
  readonly fetchStatus: ClerkFetchStatus;
}

/**
 * Both flows, read together from one clerk-js change.
 * @internal
 */
export interface ClerkFlowSnapshots {
  /** The sign-in flow. */
  readonly signIn: ClerkFlowSnapshot<ClerkSignInFuture>;
  /** The sign-up flow. */
  readonly signUp: ClerkFlowSnapshot<ClerkSignUpFuture>;
}
