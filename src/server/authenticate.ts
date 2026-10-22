import { createClerkClient } from "@clerk/backend";
import { answerHeaders } from "./handshake";
import { frontendOriginOf, handshakeTargetAllowed } from "./handshake-check";
import { type ClerkServerOptions, checkServerOptions } from "./options";
import { admit } from "./request-guard";

/**
 * The three states of a request, as `@clerk/backend` names them. `handshake` asks the server to send
 * the browser to Clerk's handshake endpoint and back (a refresh of an expired session cookie).
 * @since 1.0.0
 */
export type ServerAuthStatus = "signed-in" | "signed-out" | "handshake";

/**
 * The outcome of authenticating one request. Fields are `null` when there is no signed-in session.
 * @since 1.0.0
 */
export interface ServerAuth {
  /**
   * `signed-in`, `signed-out`, or `handshake` (the same three states as `@clerk/backend`). A handshake
   * means the session cookie is expired but the browser can refresh it: answer with `headers` (a 307 to
   * Clerk's handshake endpoint, see {@link clerkMiddleware}), do not treat the request as signed out.
   */
  readonly status: ServerAuthStatus;
  /**
   * The headers Clerk asks to be sent with the answer: `location` and `set-cookie` of a handshake, the
   * session cookies after a refresh, and `x-clerk-*` status headers. Empty for a plain signed-out request.
   * It never carries the session token itself (`x-clerk-auth-token` is dropped).
   */
  readonly headers: Headers;
  /** True only when the request carries a valid, active session token. A pending session is not signed in. */
  readonly isSignedIn: boolean;
  /** The signed-in user's id, or `null`. */
  readonly userId: string | null;
  /** The session's id, or `null`. */
  readonly sessionId: string | null;
  /** The active organization's id from the token, or `null` (also when no organization is active). */
  readonly orgId: string | null;
  /** The user's role in the active organization, or `null`. */
  readonly orgRole: string | null;
  /** The verified token claims, or `null`. */
  readonly claims: Readonly<Record<string, unknown>> | null;
  /**
   * Why the request is not signed in (`"token-expired"`, `"token-invalid-signature"`, `"session-pending"`,
   * `"token-too-large"`, `"jwks-lookup-refused"`, `"handshake-refused"`, ...), or `null`.
   * Diagnostic only: it contains no token or key material.
   */
  readonly reason: string | null;
  /**
   * A session token, or a JWT template token when `template` is given. `null` when signed out.
   * @param options `template`: the JWT template to sign the token with.
   */
  getToken(options?: {
    /** The JWT template to sign the token with. */
    readonly template?: string;
  }): Promise<string | null>;
}

/**
 * Authenticates a request with `@clerk/backend`. The token is read from the `Authorization: Bearer`
 * header or the session cookie. A missing, expired, forged or mis-addressed token gives a signed-out
 * result with a `reason`; it does not throw. Invalid options throw at once.
 *
 * Before the backend runs, an oversized token or cookie header (`token-too-large`) and a token whose unknown key id
 * would need one key lookup too many (`jwks-lookup-refused`) are answered as signed out. A handshake redirect that
 * does not go to the frontend API of the publishable key, or would return to an origin outside `authorizedParties`,
 * is refused (`handshake-refused`). A `handshake` status is answered by {@link clerkMiddleware}; a route that calls
 * this function directly must send `headers` itself.
 *
 * @param request The incoming Web `Request`.
 * @param options Keys and the allowed origins. See {@link ClerkServerOptions}.
 * @returns The authentication outcome.
 * @throws TypeError when an option is missing or malformed (the message starts with `clerk:`).
 * @example
 * ```ts
 * import { authenticateRequest } from "@shadow-js/clerk/server";
 *
 * const options = {
 *   secretKey: process.env["CLERK_SECRET_KEY"] ?? "",
 *   publishableKey: process.env["DUSK_PUBLIC_CLERK_KEY"] ?? "",
 *   authorizedParties: ["https://app.example.com"],
 * };
 *
 * export async function handleRequest(request: Request): Promise<Response> {
 *   const auth = await authenticateRequest(request, options);
 *   if (auth.status === "handshake") return new Response(null, { status: 307, headers: auth.headers });
 *   if (!auth.isSignedIn) return new Response("Unauthorized", { status: 401 });
 *   return Response.json({ userId: auth.userId });
 * }
 * ```
 * @see {@link requireAuth}
 * @see {@link clerkMiddleware}
 * @since 1.0.0
 */
export async function authenticateRequest(
  request: Request,
  options: ClerkServerOptions,
): Promise<ServerAuth> {
  const checked = checkServerOptions(options);
  const admission = admit(request, checked.publishableKey, checked.jwtKey === undefined);
  if (admission.reason !== null) return signedOutAuth(admission.reason);
  const clerk = createClerkClient({
    secretKey: checked.secretKey,
    publishableKey: checked.publishableKey,
    ...(checked.jwtKey === undefined ? {} : { jwtKey: checked.jwtKey }),
  });
  const state = await clerk.authenticateRequest(request, {
    ...(checked.authorizedParties === undefined || checked.authorizedParties === false
      ? {}
      : { authorizedParties: [...checked.authorizedParties] }),
  });
  if (state.status === "handshake" && !handshakeAllowed(state.headers, checked)) {
    // The backend can be told, by the request alone, to redirect elsewhere (a development instance follows
    // `__clerk_redirect_url`; the redirect URL is built from `X-Forwarded-Host`). Only Clerk's frontend API gets
    // a handshake, and only for an origin the application listed.
    return signedOutAuth("handshake-refused");
  }
  const auth = state.toAuth();
  // `isSignedIn` is true for a pending session (sign-in tasks not finished) while `toAuth()` is signed out and has
  // no user: a session without a user is not a signed-in session.
  const signedIn = state.isSignedIn && auth !== null && typeof auth.userId === "string";
  admission.done(signedIn, state.reason ?? null, signedIn ? (state.token ?? null) : null);
  const pending = state.isSignedIn && !signedIn;
  return {
    status: signedIn ? "signed-in" : state.status === "handshake" ? "handshake" : "signed-out",
    // Cookies stay: a pending session still needs the refreshed session cookies the handshake wrote.
    headers: answerHeaders(state.headers),
    isSignedIn: signedIn,
    userId: signedIn ? (auth.userId ?? null) : null,
    sessionId: signedIn ? (auth.sessionId ?? null) : null,
    orgId: signedIn ? (auth.orgId ?? null) : null,
    orgRole: signedIn ? (auth.orgRole ?? null) : null,
    claims: signedIn ? (auth.sessionClaims ?? null) : null,
    reason: pending ? "session-pending" : (state.reason ?? null),
    getToken: async (tokenOptions) => {
      if (!signedIn) return null;
      return auth.getToken(tokenOptions);
    },
  };
}

/** Whether the handshake redirect of the backend may be sent (see `handshake-check.ts`). */
function handshakeAllowed(headers: Headers, options: ClerkServerOptions): boolean {
  return handshakeTargetAllowed(
    headers.get("location"),
    frontendOriginOf(options.publishableKey),
    options.authorizedParties,
  );
}

/** The outcome of a request that was refused before the backend ran: signed out, no headers, no token. */
function signedOutAuth(reason: string): ServerAuth {
  return {
    status: "signed-out",
    headers: new Headers(),
    isSignedIn: false,
    userId: null,
    sessionId: null,
    orgId: null,
    orgRole: null,
    claims: null,
    reason,
    getToken: async () => null,
  };
}
