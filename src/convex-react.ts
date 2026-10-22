/**
 * `@shadow-js/clerk/convex`: the Convex provider for Clerk apps. It lives in its own entry because it
 * imports `@shadow-js/convex`, which a Clerk app without Convex does not need.
 * @packageDocumentation
 */
import { ConvexProviderWithAuth, type ConvexProviderWithAuthProps } from "@shadow-js/convex";
import { type ClerkConvexAuthOptions, clerkConvexAuth } from "./convex";

/**
 * Props of {@link ConvexProviderWithClerk}.
 * @since 1.0.0
 */
export interface ConvexProviderWithClerkProps {
  /** The Convex client, for example `createConvexClient(import.meta.env.VITE_CONVEX_URL)`. */
  readonly client: ConvexProviderWithAuthProps["client"];
  /**
   * The Clerk JWT template Convex trusts. It must match the template configured for Convex in
   * `convex/auth.config.ts`.
   * @default "convex"
   */
  readonly template?: string;
  /** The application. Rendered inside the Convex provider. */
  readonly children?: unknown;
}

/**
 * Connects Clerk to Convex. It is {@link clerkConvexAuth} with the provider wired up: the token of
 * the `convex` JWT template is registered while a user is signed in, refreshed when Convex asks for
 * a new one (`forceRefreshToken`, which skips Clerk's cache), and removed on sign-out. Read the state
 * with `useConvexAuth()` from `@shadow-js/convex`, or with `Authenticated` and `Unauthenticated`.
 *
 * Put it under `<ClerkProvider>`, because it reads the Clerk state from there.
 *
 * @param props See {@link ConvexProviderWithClerkProps}.
 * @returns The rendered children.
 * @throws Error `useAuth must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { ClerkProvider } from "@shadow-js/clerk";
 * import { ConvexProviderWithClerk } from "@shadow-js/clerk/convex";
 * import { createConvexClient } from "@shadow-js/convex";
 *
 * // The deployment URL that `npx convex dev` prints, and the publishable key from the Clerk dashboard.
 * const convex = createConvexClient("https://happy-otter-123.convex.cloud");
 * const publishableKey = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
 *
 * export function Providers(props: { children?: unknown }) {
 *   return (
 *     <ClerkProvider publishableKey={publishableKey}>
 *       <ConvexProviderWithClerk client={convex}>{props.children}</ConvexProviderWithClerk>
 *     </ClerkProvider>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function ConvexProviderWithClerk(props: ConvexProviderWithClerkProps): unknown {
  const options: ClerkConvexAuthOptions =
    props.template === undefined ? {} : { template: props.template };
  return ConvexProviderWithAuth({
    client: props.client,
    useAuth: clerkConvexAuth(options),
    get children() {
      return props.children;
    },
  });
}
