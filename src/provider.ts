import {
  batch,
  isServer,
  onCleanup,
  onMount,
  untrack,
  useEffect,
  useMemo,
  useSignal,
} from "@shadow-js/core";
import { attempt } from "./internal/actions";
import { ClerkContext, type ClerkContextValue } from "./internal/context";
import { createFlowMirror, EMPTY_FLOWS } from "./internal/flow-mirror";
import { checkPublishableKey, syncChannelName } from "./internal/keys";
import { importClerkConstructor, importClerkUi, loadInstance, withClerkUi } from "./internal/load";
import { loadClerkScripts, type ScriptOverrides } from "./internal/script";
import { createSessionSync, type SessionSync } from "./internal/session-sync";
import type {
  ClerkClientLike,
  ClerkFlowSnapshot,
  ClerkLike,
  ClerkLoadOptions,
  ClerkMembershipLike,
  ClerkOrganizationLike,
  ClerkResourcesLike,
  ClerkSessionLike,
  ClerkSignInFuture,
  ClerkSignUpFuture,
  ClerkUserLike,
} from "./types";

/**
 * How the provider gets `@clerk/clerk-js` and `@clerk/ui` into the page.
 *
 * - `"script"` (default): Clerk's own browser bundles are loaded from Clerk's frontend API host, as
 *   `@clerk/react` does. They are not part of the app's bundle, they cache across sites and they load
 *   after first paint. Needs no Clerk package installed.
 * - `"bundled"`: the packages are imported from the app's bundle (lazy chunks). For offline,
 *   air-gapped and strict-CSP apps that cannot reach the frontend API host. Needs `@clerk/clerk-js`
 *   and `@clerk/ui` installed.
 * @since 1.0.0
 */
export type ClerkProviderMode = "script" | "bundled";

/**
 * Props of {@link ClerkProvider}. The script URL overrides (`clerkJSUrl`, `clerkJSVersion`, `clerkUIUrl`,
 * `clerkUIVersion`) apply to script mode only.
 * @since 1.0.0
 */
export interface ClerkProviderProps extends ScriptOverrides {
  /**
   * Clerk publishable key (`pk_test_...` or `pk_live_...`). Checked for shape when the provider renders (a
   * `TypeError` that does not repeat the value), never sent anywhere by the provider itself. In script mode it must
   * also decode to a Clerk frontend API host, which is where the scripts are loaded from.
   */
  readonly publishableKey: string;
  /**
   * An existing Clerk instance to use instead of loading Clerk. Used by tests, and by apps that
   * already create their own instance. It is loaded with `loadOptions` if it is not loaded.
   */
  readonly clerk?: ClerkLike;
  /** Options passed to `clerk.load()`, for example `signInUrl` or `appearance`. See {@link ClerkLoadOptions}. */
  readonly loadOptions?: ClerkLoadOptions;
  /**
   * How Clerk's packages reach the page, see {@link ClerkProviderMode}. Ignored with `clerk`. Any other value throws a
   * `TypeError` when the provider renders.
   * @default "script"
   */
  readonly mode?: ClerkProviderMode | undefined;
  /**
   * The nonce of the page's Content Security Policy. Written to the Clerk script elements (script
   * mode) so a `script-src` with `'nonce-...'` allows them. Pass the value your server wrote. An empty string
   * writes no nonce.
   */
  readonly nonce?: string | undefined;
  /**
   * How long each Clerk script may take to define its global, in milliseconds (script mode). Each script is tried
   * twice before the load fails.
   * @default 15000
   */
  readonly scriptLoadTimeout?: number | undefined;
  /** The application. Rendered once the provider exists; the hooks read the mirrored state. */
  readonly children?: unknown;
}

/** The mode of the props, or the default. Anything else is a configuration mistake, reported before a load. */
function checkMode(mode: ClerkProviderMode | undefined): ClerkProviderMode {
  if (mode === undefined || mode === "script" || mode === "bundled") return mode ?? "script";
  throw new TypeError(
    __DEV__ ? 'ClerkProvider: mode must be "script" or "bundled".' : "CLERK_MODE",
  );
}

/**
 * Provides Clerk state to the subtree. On the client it loads Clerk (or uses the `clerk` prop),
 * subscribes to every change with `addListener`, and mirrors the user, session, organization and
 * loaded flag into signals in one batch per change. On the server it renders the children with the
 * unloaded state and loads nothing. Every hook and component of this package must be rendered under it.
 *
 * A failed load or a failed action throws to the nearest `ErrorBoundary`, and the boundary's reset
 * mounts the provider again, which retries the load. A failed script load says what to check: the
 * Content Security Policy, an ad blocker, or the network. The provider also keeps the tabs of one browser on the
 * same session: a sign-in, account switch or organization switch in one tab reaches the others.
 *
 * @param props See {@link ClerkProviderProps}.
 * @returns The provider's children, wrapped in the Clerk context.
 * @throws TypeError when rendered with a `publishableKey` that is not a Clerk publishable key, or with a `mode` other
 *   than `"script"` or `"bundled"` (on the server too). Load failures, an invalid script URL or version and a second
 *   publishable key on one page (script mode allows one) are thrown later, to the nearest `ErrorBoundary`.
 * @example
 * ```tsx
 * import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@shadow-js/clerk";
 *
 * // The publishable key from the Clerk dashboard.
 * const publishableKey = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
 *
 * export function App() {
 *   return (
 *     <ClerkProvider publishableKey={publishableKey}>
 *       <SignedOut>
 *         <SignInButton />
 *       </SignedOut>
 *       <SignedIn>
 *         <UserButton />
 *       </SignedIn>
 *     </ClerkProvider>
 *   );
 * }
 * ```
 * @see {@link useAuth}
 * @since 1.0.0
 */
export function ClerkProvider(props: ClerkProviderProps): unknown {
  const publishableKey = checkPublishableKey(props.publishableKey);
  const mode = checkMode(props.mode);

  const [instance, setInstance] = useSignal<ClerkLike | null>(null);
  const [loaded, setLoaded] = useSignal(false);
  const [client, setClient] = useSignal<ClerkClientLike | undefined>(undefined);
  const [user, setUser] = useSignal<ClerkUserLike | null | undefined>(undefined);
  const [session, setSession] = useSignal<ClerkSessionLike | null | undefined>(undefined);
  const [organization, setOrganization] = useSignal<ClerkOrganizationLike | null | undefined>(
    undefined,
  );
  const [failure, setFailure] = useSignal<{ readonly error: unknown } | undefined>(undefined);
  const [signIn, setSignIn] = useSignal<ClerkFlowSnapshot<ClerkSignInFuture>>(EMPTY_FLOWS.signIn);
  const [signUp, setSignUp] = useSignal<ClerkFlowSnapshot<ClerkSignUpFuture>>(EMPTY_FLOWS.signUp);
  /**
   * Mirrors clerk-js's future sign-in and sign-up state, one subscription per loaded instance (see
   * {@link createFlowMirror}). Each change writes both flows in one batch.
   */
  const flows = createFlowMirror((next) => {
    batch(() => {
      setSignIn(next.signIn);
      setSignUp(next.signUp);
    });
  });

  /** Set by the owner's cleanup. Late loads and listener calls check it and do nothing. */
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  const fail = (error: unknown): void => {
    if (disposed) return;
    setFailure({ error });
  };

  const isSignedIn = useMemo<boolean>(() => session()?.status === "active");
  const visibleClerk = useMemo<ClerkLike | null>(() => (loaded() ? instance() : null));
  const membership = useMemo<ClerkMembershipLike | null>(() => {
    const current = organization();
    const currentUser = user();
    if (!isSignedIn() || current === null || current === undefined) return null;
    if (currentUser === null || currentUser === undefined) return null;
    const memberships = currentUser.organizationMemberships ?? [];
    return memberships.find((item) => item.organization.id === current.id) ?? null;
  });

  /** One batch per Clerk event: readers see the user, session and organization change together. */
  const apply = (resources: ClerkResourcesLike, clerk: ClerkLike): void => {
    sync?.observe(resources);
    batch(() => {
      setClient(resources.client);
      setUser(resources.user);
      setSession(resources.session);
      setOrganization(resources.organization);
      setLoaded(clerk.loaded);
    });
    flows.follow(clerk.loaded ? clerk : null);
  };

  const snapshot = (clerk: ClerkLike): ClerkResourcesLike => ({
    client: clerk.client,
    user: clerk.user,
    session: clerk.session,
    organization: clerk.organization,
  });

  /**
   * Keeps this tab on the same session as the other tabs of the browser (sign-in, account and
   * organization switches), see {@link createSessionSync}. Created on mount, on the client only.
   */
  let current: ClerkLike | undefined;
  let sync: SessionSync | undefined;

  const attach = (clerk: ClerkLike, loadOptions: ClerkLoadOptions | undefined): void => {
    if (disposed) return;
    unsubscribe = clerk.addListener((resources) => {
      if (!disposed) apply(resources, clerk);
    });
    setInstance(clerk);
    current = clerk;
    if (clerk.loaded) {
      apply(snapshot(clerk), clerk);
      return;
    }
    // `.catch` rather than a second `then` argument: a throw from applying the loaded state (an unreadable resource)
    // must reach the boundary too, not become an unhandled rejection.
    loadInstance(clerk, loadOptions)
      .then(() => {
        if (!disposed) apply(snapshot(clerk), clerk);
      })
      .catch(fail);
  };

  /** Aborts the Clerk script loads of this provider when it is disposed. Created on mount. */
  let scripts: AbortController | undefined;

  const start = (signal: AbortSignal): void => {
    const injected = props.clerk;
    if (injected !== undefined) {
      // An injected instance is loaded with the options the caller gave; it brings its own UI bundle.
      attempt(() => attach(injected, props.loadOptions), fail);
      return;
    }
    if (mode === "bundled") {
      Promise.all([importClerkConstructor(), importClerkUi()]).then(([Clerk, ClerkUI]) => {
        if (disposed) return;
        attempt(
          () => attach(new Clerk(publishableKey), withClerkUi(props.loadOptions, ClerkUI)),
          fail,
        );
      }, fail);
      return;
    }
    loadClerkScripts({
      publishableKey,
      nonce: props.nonce,
      timeoutMs: props.scriptLoadTimeout,
      clerkJSUrl: props.clerkJSUrl,
      clerkJSVersion: props.clerkJSVersion,
      clerkUIUrl: props.clerkUIUrl,
      clerkUIVersion: props.clerkUIVersion,
      signal,
    }).then(({ clerk, ClerkUI }) => {
      if (disposed) return;
      attempt(() => attach(clerk, withClerkUi(props.loadOptions, ClerkUI)), fail);
    }, fail);
  };

  if (!isServer) {
    onMount(() => {
      if (typeof window !== "undefined" && typeof document !== "undefined") {
        const created = createSessionSync({
          name: syncChannelName(publishableKey),
          clerk: () => current,
        });
        sync = created;
        const refreshOnFocus = (): void => created.tabFocused();
        window.addEventListener("focus", refreshOnFocus);
        document.addEventListener("visibilitychange", refreshOnFocus);
        onCleanup(() => {
          window.removeEventListener("focus", refreshOnFocus);
          document.removeEventListener("visibilitychange", refreshOnFocus);
          created.dispose();
          sync = undefined;
        });
      }
      const controller = new AbortController();
      scripts = controller;
      start(controller.signal);
    });
  }

  onCleanup(() => {
    disposed = true;
    scripts?.abort();
    scripts = undefined;
    if (unsubscribe !== undefined) unsubscribe();
    unsubscribe = undefined;
    flows.follow(null);
  });

  const value: ClerkContextValue = {
    clerk: visibleClerk,
    isLoaded: loaded,
    client,
    user,
    session,
    organization,
    isSignedIn,
    membership,
    signIn,
    signUp,
    fail,
  };

  // A failure is thrown from an effect owned by the provider, so the nearest ErrorBoundary catches
  // it. Throwing from a memo would not work: the boundary reads its children outside its own scope.
  useEffect(() => {
    const current = failure();
    if (current !== undefined) throw current.error;
  });

  return ClerkContext({
    value,
    get children() {
      return untrack(() => props.children);
    },
  });
}
