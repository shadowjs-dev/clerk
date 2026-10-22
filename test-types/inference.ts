import type { Accessor } from "@shadow-js/core";
import { type ClerkConvexAuthOptions, type ConvexAuthState, clerkConvexAuth } from "../src/convex";
import {
  type AuthState,
  type ClerkProviderMode,
  type OrganizationListState,
  type OrganizationState,
  type SessionState,
  type SignInState,
  type SignUpState,
  type UserState,
  useAuth,
  type useClerk,
  type useOrganization,
  useOrganizationList,
  type useSession,
  useSignIn,
  type useSignUp,
  useUser,
} from "../src/index";
import {
  authenticateRequest,
  createRouteMatcher,
  type RouteMatcher,
  type requireAuth,
  type ServerAuth,
  type ServerAuthStatus,
  type VerifyWebhookOptions,
  verifyWebhook,
  type WebhookEvent,
  type WebhookFailureReason,
  WebhookVerificationError,
} from "../src/server";
import type {
  ClerkLike,
  ClerkMembershipLike,
  ClerkOrganizationLike,
  ClerkSessionLike,
  ClerkSignInFuture,
  ClerkSignUpFuture,
  ClerkTokenOptions,
  ClerkUserLike,
} from "../src/types";
import type { Equal, Expect } from "./support";

// Hooks: return types and state fields.
type _UseAuthReturn = Expect<Equal<ReturnType<typeof useAuth>, AuthState>>;
type _AuthIsLoaded = Expect<Equal<AuthState["isLoaded"], Accessor<boolean>>>;
type _AuthUserId = Expect<Equal<AuthState["userId"], Accessor<string | null>>>;
type _AuthOrgRole = Expect<Equal<AuthState["orgRole"], Accessor<string | null>>>;
type _AuthGetToken = Expect<Equal<ReturnType<AuthState["getToken"]>, Promise<string | null>>>;
type _AuthSignOut = Expect<Equal<ReturnType<AuthState["signOut"]>, Promise<void>>>;
type _AuthTokenOptions = Expect<
  Equal<Parameters<AuthState["getToken"]>[0], ClerkTokenOptions | undefined>
>;

type _UseUserReturn = Expect<Equal<ReturnType<typeof useUser>, UserState>>;
type _UserValue = Expect<Equal<UserState["user"], Accessor<ClerkUserLike | null | undefined>>>;

type _UseSessionReturn = Expect<Equal<ReturnType<typeof useSession>, SessionState>>;
type _SessionValue = Expect<
  Equal<SessionState["session"], Accessor<ClerkSessionLike | null | undefined>>
>;

type _UseOrganizationReturn = Expect<Equal<ReturnType<typeof useOrganization>, OrganizationState>>;
type _OrganizationValue = Expect<
  Equal<OrganizationState["organization"], Accessor<ClerkOrganizationLike | null | undefined>>
>;
type _MembershipValue = Expect<
  Equal<OrganizationState["membership"], Accessor<ClerkMembershipLike | null>>
>;

type _UseOrganizationListReturn = Expect<
  Equal<ReturnType<typeof useOrganizationList>, OrganizationListState>
>;
type _MembershipsValue = Expect<
  Equal<OrganizationListState["memberships"], Accessor<readonly ClerkMembershipLike[] | undefined>>
>;

type _UseSignInReturn = Expect<Equal<ReturnType<typeof useSignIn>, SignInState>>;
type _SignInValue = Expect<Equal<SignInState["signIn"], Accessor<ClerkSignInFuture | null>>>;
type _SignInSetActive = Expect<Equal<ReturnType<SignInState["setActive"]>, Promise<void>>>;

type _UseSignUpReturn = Expect<Equal<ReturnType<typeof useSignUp>, SignUpState>>;
type _SignUpValue = Expect<Equal<SignUpState["signUp"], Accessor<ClerkSignUpFuture | null>>>;

type _UseClerkReturn = Expect<Equal<ReturnType<typeof useClerk>, Accessor<ClerkLike | null>>>;

// Hooks: negative cases.
// @ts-expect-error userId is a string accessor, not a boolean one
const _wrongAccessor: Accessor<boolean> = useAuth().userId;
// @ts-expect-error template must be a string
const _wrongTemplate = useAuth().getToken({ template: 1 });
// @ts-expect-error hooks take no arguments
const _wrongArgs = useAuth(1);
// @ts-expect-error user state has no email field
const _wrongField = useUser().email;
// @ts-expect-error organization id must be a string or null
const _wrongSetActive = useOrganizationList().setActive({ organization: 1 });
// @ts-expect-error session id must be a string or null
const _wrongSignIn = useSignIn().setActive({ session: 1 });
// @ts-expect-error provider mode is "script" or "bundled"
const _wrongMode: ClerkProviderMode = "iframe";
// @ts-expect-error token options take a string template
const _wrongTokenOptions: ClerkTokenOptions = { template: 1 };

// Convex auth.
type _ConvexReturn = Expect<Equal<ReturnType<typeof clerkConvexAuth>, () => ConvexAuthState>>;
type _ConvexLoading = Expect<Equal<ConvexAuthState["isLoading"], boolean>>;
type _ConvexAuthenticated = Expect<Equal<ConvexAuthState["isAuthenticated"], boolean>>;
type _ConvexFetch = Expect<
  Equal<ReturnType<ConvexAuthState["fetchAccessToken"]>, Promise<string | null>>
>;
type _ConvexForce = Expect<
  Equal<Parameters<ConvexAuthState["fetchAccessToken"]>[0], { readonly forceRefreshToken: boolean }>
>;
type _ConvexOptions = Expect<Equal<ClerkConvexAuthOptions["template"], string | undefined>>;

// @ts-expect-error template must be a string
const _wrongConvexOptions: ClerkConvexAuthOptions = { template: 1 };
// @ts-expect-error the returned function has no isLoading property
const _wrongConvexState = clerkConvexAuth().isLoading;

// Server auth.
type _ServerStatus = Expect<Equal<ServerAuthStatus, "signed-in" | "signed-out" | "handshake">>;
type _ServerSignedIn = Expect<Equal<ServerAuth["isSignedIn"], boolean>>;
type _ServerUserId = Expect<Equal<ServerAuth["userId"], string | null>>;
type _ServerSessionId = Expect<Equal<ServerAuth["sessionId"], string | null>>;
type _ServerOrgId = Expect<Equal<ServerAuth["orgId"], string | null>>;
type _ServerClaims = Expect<Equal<ServerAuth["claims"], Readonly<Record<string, unknown>> | null>>;
type _ServerReason = Expect<Equal<ServerAuth["reason"], string | null>>;
type _ServerGetToken = Expect<Equal<ReturnType<ServerAuth["getToken"]>, Promise<string | null>>>;
type _AuthenticateReturn = Expect<
  Equal<ReturnType<typeof authenticateRequest>, Promise<ServerAuth>>
>;
type _RequireAuthReturn = Expect<Equal<ReturnType<typeof requireAuth>, Promise<ServerAuth>>>;

// @ts-expect-error the server status is a fixed union
const _wrongStatus: ServerAuthStatus = "unknown";
// @ts-expect-error the request and server options are both required
const _wrongAuthenticate = authenticateRequest(new Request("https://example.com"), {});
const _wrongWrite = (auth: ServerAuth): void => {
  // @ts-expect-error server auth is read-only
  auth.status = "signed-in";
};

// Route matcher.
type _RouteMatcherReturn = Expect<Equal<ReturnType<typeof createRouteMatcher>, RouteMatcher>>;
// @ts-expect-error caseSensitive must be a boolean
const _wrongMatcher = createRouteMatcher(["/app"], { caseSensitive: "yes" });

// Webhooks.
type _FailureReasons = Expect<
  Equal<
    WebhookFailureReason,
    | "missing-headers"
    | "bad-timestamp"
    | "timestamp-out-of-tolerance"
    | "bad-signature"
    | "bad-body"
    | "body-too-large"
  >
>;
type _VerifyReturn = Expect<Equal<ReturnType<typeof verifyWebhook>, Promise<WebhookEvent>>>;
type _EventType = Expect<Equal<WebhookEvent["type"], string>>;
type _EventData = Expect<Equal<WebhookEvent["data"], Readonly<Record<string, unknown>>>>;
type _EventObject = Expect<Equal<WebhookEvent["object"], string | undefined>>;
type _ErrorReason = Expect<Equal<WebhookVerificationError["reason"], WebhookFailureReason>>;
type _ErrorReasonParameter = Expect<
  Equal<ConstructorParameters<typeof WebhookVerificationError>[0], WebhookFailureReason>
>;
type _VerifySecret = Expect<Equal<VerifyWebhookOptions["secret"], string>>;

// @ts-expect-error the failure reason is a fixed union
const _wrongReason: WebhookFailureReason = "timeout";
// @ts-expect-error the error reason must be a failure reason
const _wrongError = new WebhookVerificationError("bad", "nope");
// @ts-expect-error the webhook secret is required
const _wrongVerify = verifyWebhook(new Request("https://example.com"), {});
const _wrongTolerance = verifyWebhook(new Request("https://example.com"), {
  secret: "whsec_test",
  // @ts-expect-error the tolerance is a number of seconds
  toleranceSeconds: "5",
});
// @ts-expect-error the event has no extra fields
const _wrongEvent: WebhookEvent = { type: "user.created", data: {}, extra: true };
