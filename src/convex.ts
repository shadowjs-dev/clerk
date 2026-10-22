import { type AuthState, useAuth } from "./hooks";

/**
 * The auth state `@shadow-js/convex`'s `ConvexProviderWithAuth` reads. Declared here by shape only,
 * so this package does not depend on Convex. {@link clerkConvexAuth} builds it.
 * @since 1.0.0
 */
export interface ConvexAuthState {
  /** True until Clerk has loaded. A getter over the Clerk state, so reading it inside a binding tracks it. */
  readonly isLoading: boolean;
  /** True while Clerk reports an active session (a pending session is not one). A getter, like `isLoading`. */
  readonly isAuthenticated: boolean;
  /**
   * Resolves a Clerk JWT of the configured template for Convex, or `null` when there is no active session. A failed
   * token request also resolves `null` (with a `console.warn`), so Convex asks again instead of waiting.
   * @param args `forceRefreshToken: true` skips Clerk's token cache.
   */
  fetchAccessToken(args: {
    /** `true` when Convex needs a new token; sent to Clerk as `skipCache`. */
    readonly forceRefreshToken: boolean;
  }): Promise<string | null>;
}

/**
 * Options of {@link clerkConvexAuth}.
 * @since 1.0.0
 */
export interface ClerkConvexAuthOptions {
  /**
   * The Clerk JWT template that issues tokens Convex accepts. It must match the template configured
   * for Convex in the Clerk dashboard.
   * @default "convex"
   */
  readonly template?: string;
}

/**
 * Builds the `useAuth` hook that `ConvexProviderWithAuth` expects, backed by Clerk. Pass the result
 * to the provider as its auth hook. `isLoading` and `isAuthenticated` are getters over the Clerk
 * state, so they stay current, and `fetchAccessToken` requests the template token (cache skipped
 * when a refresh is forced). {@link ConvexProviderWithClerk} from `@shadow-js/clerk/convex` is this hook with the
 * provider already wired up.
 *
 * @param options See {@link ClerkConvexAuthOptions}.
 * @returns A hook returning a {@link ConvexAuthState}. Call it inside a component under a `ClerkProvider`; outside
 *   one, the hook throws an Error naming `useAuth`.
 * @example
 * ```tsx
 * import { clerkConvexAuth } from "@shadow-js/clerk";
 * import { type ConvexClientLike, ConvexProviderWithAuth } from "@shadow-js/convex";
 *
 * const useConvexAuth = clerkConvexAuth({ template: "convex" });
 *
 * export function ConvexRoot(props: { client: ConvexClientLike; children?: unknown }) {
 *   return (
 *     <ConvexProviderWithAuth client={props.client} useAuth={useConvexAuth}>
 *       {props.children}
 *     </ConvexProviderWithAuth>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function clerkConvexAuth(options: ClerkConvexAuthOptions = {}): () => ConvexAuthState {
  const template = options.template ?? "convex";
  return function useClerkConvexAuth(): ConvexAuthState {
    const auth: AuthState = useAuth();
    return {
      get isLoading() {
        return !auth.isLoaded();
      },
      get isAuthenticated() {
        return auth.isSignedIn();
      },
      fetchAccessToken: async ({ forceRefreshToken }) => {
        // A failed request is answered with no token, as the contract says. A rejection would leave Convex waiting for
        // a token that never comes, with its socket paused, so no query would settle.
        try {
          return await auth.getToken({ template, skipCache: forceRefreshToken });
        } catch (error) {
          console.warn(
            "clerkConvexAuth: the Convex token request failed; Convex will ask again.",
            error,
          );
          return null;
        }
      },
    };
  };
}
