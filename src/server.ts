/**
 * `@shadow-js/clerk/server`: server-side authentication with `@clerk/backend`. It is safe to import
 * on the server only; it needs the secret key and must never run in a browser bundle.
 * @packageDocumentation
 */
export type { ServerAuth, ServerAuthStatus } from "./server/authenticate";
export { authenticateRequest } from "./server/authenticate";
export type {
  ClerkMiddleware,
  ClerkMiddlewareEvent,
  ClerkMiddlewareOptions,
} from "./server/middleware";
export { clerkMiddleware, getAuth } from "./server/middleware";
export type { ClerkServerOptions } from "./server/options";
export type { RequireAuthOptions } from "./server/require-auth";
export { requireAuth } from "./server/require-auth";
export type {
  RouteMatcher,
  RouteMatcherOptions,
  RouteMatchInput,
} from "./server/route-matcher";
export { createRouteMatcher } from "./server/route-matcher";
export type {
  VerifyWebhookOptions,
  WebhookEvent,
  WebhookFailureReason,
} from "./server/webhook";
export { verifyWebhook, WebhookVerificationError } from "./server/webhook";
