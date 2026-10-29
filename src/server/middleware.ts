import { authenticateRequest, type ServerAuth } from "./authenticate";
import { handshakeResponse, withAnswerHeaders } from "./handshake";
import { type ClerkServerOptions, checkedAppPath, checkServerOptions } from "./options";
import type { RouteMatcher } from "./route-matcher";

/**
 * The event the middleware reads. Any object with the request fits; the framework's request event
 * is one.
 * @since 1.0.0
 */
export interface ClerkMiddlewareEvent {
  /** The incoming Web `Request`. It is authenticated, and `protect` checks its URL. */
  readonly request: Request;
  /**
   * The URL the framework resolves the route from, when it differs from the request's (a config rewrite moves
   * `event.url` and leaves the request alone). `protect` checks both.
   */
  readonly url?: URL;
}

/**
 * A middleware in the `(event, next)` onion used by `@shadow-js/dusk`: it receives the event and a `next` that runs
 * the inner middleware and handlers, and resolves the response to send. {@link clerkMiddleware} returns one.
 * @since 1.0.0
 */
export type ClerkMiddleware = (
  event: ClerkMiddlewareEvent,
  next: () => Promise<Response>,
) => Promise<Response>;

/**
 * Options of {@link clerkMiddleware}: the server options, plus an optional protection of matched routes.
 * @since 1.0.0
 */
export interface ClerkMiddlewareOptions extends ClerkServerOptions {
  /**
   * Routes that need a session (`protect()` in Clerk's API). A request the matcher accepts, and that is
   * not signed in, is answered before the inner handlers run: a `307` to `signInUrl` with `redirect_url`
   * set to the requested path and query (so sign-in returns the user there), or a `401` when no sign-in
   * URL is given. Build the matcher with `createRouteMatcher`.
   */
  readonly protect?: {
    /** Decides which requests need a session: one built with `createRouteMatcher`. */
    readonly matcher: RouteMatcher;
    /**
     * A same-app path such as `/sign-in`, optionally with its own query and fragment: it starts with one `/` and has
     * no whitespace, control character or backslash. Anything else throws a `TypeError` when the middleware is
     * created. A request for this page itself is never redirected, even when the matcher covers it. Without it, the answer is a `401`.
     */
    readonly signInUrl?: string;
  };
}

/** The authentication outcome of each event, held weakly so it is dropped with the request. */
const authByEvent = new WeakMap<object, ServerAuth>();

/**
 * Creates a middleware that authenticates every request (with {@link authenticateRequest}) and makes the outcome
 * available to inner middleware and handlers through {@link getAuth}.
 *
 * The answer follows `@clerk/backend`:
 * - `handshake` (an expired session cookie the browser can refresh): a `307` to Clerk's handshake URL
 *   with the cookies Clerk sets, and the inner handlers do not run. Clerk sends the browser back to the
 *   same URL with the refreshed session.
 * - `signed-in` and `signed-out`: the inner handlers run, and Clerk's `x-clerk-*` status headers and any
 *   refreshed session cookies are added to their response. The session token is never sent to the browser.
 *
 * It never blocks a request on its own, except through `protect` (see {@link ClerkMiddlewareOptions}); the
 * route can also call `requireAuth`. Options are checked when the middleware is created.
 *
 * A `protect` redirect is a `307` to `signInUrl` with `redirect_url` set to the requested path and query (a leading
 * `//` collapsed to `/`), with `cache-control: no-store`; without `signInUrl` it is a `401` with the text
 * `Unauthorized`.
 *
 * @param options Keys, the allowed origins, and an optional `protect`. See {@link ClerkMiddlewareOptions}.
 * @returns A middleware `(event, next) => Promise<Response>`.
 * @throws TypeError when an option is missing or malformed, or `protect.signInUrl` is not a same-app path.
 * @example
 * ```ts
 * import { clerkMiddleware, createRouteMatcher, getAuth } from "@shadow-js/clerk/server";
 *
 * const clerk = clerkMiddleware({
 *   secretKey: process.env["CLERK_SECRET_KEY"] ?? "",
 *   publishableKey: process.env["DUSK_PUBLIC_CLERK_KEY"] ?? "",
 *   authorizedParties: ["https://app.example.com"],
 *   protect: { matcher: createRouteMatcher(["/dashboard(.*)"]), signInUrl: "/sign-in" },
 * });
 *
 * export function handle(request: Request): Promise<Response> {
 *   const event = { request };
 *   return clerk(event, async () => Response.json({ userId: getAuth(event)?.userId ?? null }));
 * }
 * ```
 * @see {@link createRouteMatcher}
 * @see {@link requireAuth}
 * @since 1.0.0
 */
export function clerkMiddleware(options: ClerkMiddlewareOptions): ClerkMiddleware {
  const checked = checkServerOptions(options);
  const protection = options.protect;
  const signInUrl =
    protection?.signInUrl === undefined
      ? undefined
      : checkedAppPath(protection.signInUrl, "protect.signInUrl");
  // The sign-in page is never protected from itself: a matcher such as `/(.*)` covers it, and redirecting it to itself
  // would add one more level of `redirect_url` on every hop until the browser gives up.
  const signInPath = signInUrl === undefined ? undefined : pathOfPath(signInUrl);
  return async (event, next) => {
    const auth = await authenticateRequest(event.request, checked);
    authByEvent.set(event, auth);
    const handshake = handshakeResponse(auth);
    if (handshake !== undefined) return handshake;
    if (
      protection !== undefined &&
      !auth.isSignedIn &&
      covers(protection.matcher, event) &&
      !isSignInPage(event, signInPath)
    ) {
      return protectedAnswer(event.request, signInUrl);
    }
    return withAnswerHeaders(await next(), auth.headers);
  };
}

/** The pathname of an app path (`/sign-in?lang=ar` gives `/sign-in`), without a trailing slash. */
function pathOfPath(path: string): string {
  return trimSlash(new URL(path, "http://app.invalid").pathname);
}

function trimSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** Whether the request, and the URL the framework moved the event to, are both the sign-in page `protect` redirects to. */
function isSignInPage(event: ClerkMiddlewareEvent, signInPath: string | undefined): boolean {
  const urls = [new URL(event.request.url), ...(event.url === undefined ? [] : [event.url])];
  return signInPath !== undefined && urls.every((url) => trimSlash(url.pathname) === signInPath);
}

/** Whether the rule covers the request, or the URL the framework moved the event to. */
function covers(matcher: RouteMatcher, event: ClerkMiddlewareEvent): boolean {
  return matcher(event.request) || (event.url !== undefined && matcher(event.url));
}

/** The answer to a request that needs a session and has none: a sign-in redirect, or a 401. */
function protectedAnswer(request: Request, signInUrl: string | undefined): Response {
  if (signInUrl === undefined) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const url = new URL(request.url);
  // `//evil.example` is a valid pathname; as redirect_url it would be a protocol-relative URL to the sign-in page.
  const back = `${url.pathname.replace(/^\/{2,}/, "/")}${url.search}`;
  const target = new URL(signInUrl, "http://app.invalid");
  target.searchParams.append("redirect_url", back);
  const location = `${target.pathname}${target.search}${target.hash}`;
  return new Response(null, { status: 307, headers: { location, "cache-control": "no-store" } });
}

/**
 * Reads the outcome that {@link clerkMiddleware} stored for this event. Pass the same event object the middleware
 * received; the outcome is held weakly, so it is dropped with the event.
 *
 * @param event The event the middleware received.
 * @returns The authentication outcome, or `undefined` when no Clerk middleware ran for this event.
 * @example
 * ```ts
 * import { type ClerkMiddlewareEvent, getAuth } from "@shadow-js/clerk/server";
 *
 * export async function dashboard(event: ClerkMiddlewareEvent): Promise<Response> {
 *   const auth = getAuth(event);
 *   if (auth === undefined || !auth.isSignedIn) return new Response("Unauthorized", { status: 401 });
 *   return Response.json({ userId: auth.userId, orgId: auth.orgId });
 * }
 * ```
 * @since 1.0.0
 */
export function getAuth(event: ClerkMiddlewareEvent): ServerAuth | undefined {
  return authByEvent.get(event);
}
