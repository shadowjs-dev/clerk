import { authenticateRequest, type ServerAuth } from "./authenticate";
import { type ClerkServerOptions, checkedAppPath, hasUnsafeTargetChar } from "./options";

/**
 * Options of {@link requireAuth}.
 * @since 1.0.0
 */
export interface RequireAuthOptions extends ClerkServerOptions {
  /**
   * Where a signed-out visitor is sent (a relative path such as `/sign-in`, or an `https://` URL).
   * When omitted, the response is `401` instead of a redirect. A path must start with one `/`; neither form may hold
   * whitespace, a control character or a backslash. Any other value throws a `TypeError` when a signed-out request
   * reaches it.
   */
  readonly signInUrl?: string;
}

/** Only same-app paths and https URLs. A protocol-relative or `javascript:` target is rejected. */
function checkSignInUrl(url: string): string {
  if (typeof url === "string" && url.startsWith("https://") && !hasUnsafeTargetChar(url)) {
    return url;
  }
  try {
    return checkedAppPath(url, "signInUrl");
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TypeError(
        "clerk: signInUrl must be a relative path (/sign-in) or an https:// URL.",
      );
    }
    throw error;
  }
}

/**
 * Returns the authentication outcome for a request that must be signed in. Otherwise it rejects
 * with a `Response`: a `302` to `signInUrl` when one is configured, else a `401`. Throw it from a
 * route or a middleware and the framework sends it as the response. Both carry `cache-control: no-store`. A
 * pending session and a `handshake` outcome are not signed in; to answer handshakes, put {@link clerkMiddleware} in
 * front.
 *
 * @param request The incoming Web `Request`.
 * @param options Keys, allowed origins and the optional sign-in URL. See {@link RequireAuthOptions}.
 * @returns The signed-in authentication outcome.
 * @throws Response a `302` to the sign-in URL, or a `401` with the text `Unauthorized`, when the request is not
 *   signed in.
 * @throws TypeError when an option is missing or malformed, or `signInUrl` is not a same-app path or `https://` URL.
 * @example
 * ```ts
 * import { requireAuth } from "@shadow-js/clerk/server";
 *
 * const keys = {
 *   secretKey: process.env["CLERK_SECRET_KEY"] ?? "",
 *   publishableKey: process.env["DUSK_PUBLIC_CLERK_KEY"] ?? "",
 *   authorizedParties: ["https://app.example.com"],
 *   signInUrl: "/sign-in",
 * };
 *
 * export async function handleRequest(request: Request): Promise<Response> {
 *   try {
 *     const auth = await requireAuth(request, keys);
 *     return Response.json({ userId: auth.userId });
 *   } catch (thrown) {
 *     if (thrown instanceof Response) return thrown;
 *     throw thrown;
 *   }
 * }
 * ```
 * @see {@link createRouteMatcher}
 * @since 1.0.0
 */
export async function requireAuth(
  request: Request,
  options: RequireAuthOptions,
): Promise<ServerAuth> {
  const auth = await authenticateRequest(request, options);
  if (auth.isSignedIn) return auth;
  if (options.signInUrl !== undefined) {
    const location = checkSignInUrl(options.signInUrl);
    throw new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
  }
  throw new Response("Unauthorized", {
    status: 401,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
