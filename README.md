<p align="center"><img src="https://raw.githubusercontent.com/shadowjs-dev/clerk/main/.github/banner.png" alt="ShadowJS" width="100%"></p>

# @shadow-js/clerk

[![npm](https://img.shields.io/npm/v/@shadow-js/clerk.svg)](https://www.npmjs.com/package/@shadow-js/clerk)
[![CI](https://github.com/shadowjs-dev/clerk/actions/workflows/ci.yml/badge.svg)](https://github.com/shadowjs-dev/clerk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/shadowjs-dev/clerk/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

Clerk authentication for ShadowJS: a provider that loads Clerk on the client (Clerk's own bundles from
its frontend API host by default, or `@clerk/clerk-js` from the app bundle with `mode="bundled"`), hooks that
return accessors, components that show content by auth state and mount Clerk's UI, a bridge to
Convex auth, and server helpers built on `@clerk/backend`.

Tested against `@clerk/clerk-js` 6.38.1, `@clerk/ui` 1.39.1 and `@clerk/backend` 3.23.1. The peer ranges are
`@clerk/clerk-js >=5`, `@clerk/ui >=1.39.1` and `@clerk/backend >=2`: all optional. Each is needed only by the
mode or the helpers that use it.

## Install

```sh
npm install @shadow-js/clerk
npm install @clerk/backend
```

The default `script` mode needs nothing else: the provider loads Clerk's bundles from the frontend API host of the
key. The `bundled` mode (`<ClerkProvider mode="bundled">`, for offline and strict-CSP apps) also needs `npm install
@clerk/clerk-js @clerk/ui react react-dom`, because `clerk.load()` needs a UI bundle and `@clerk/ui` renders with React.
`@clerk/backend` is needed only if you use `@shadow-js/clerk/server`. `@shadow-js/core` and
`@shadow-js/web` are peer dependencies. ShadowJS 1.0.0 is not on npm yet; until it is published,
install the packages from this repository's workspace.

## Example

Wrap the application in `ClerkProvider` once, with the publishable key. On the client the provider loads
Clerk when it mounts (see the guide's "Loading modes") and mirrors Clerk's state into signals. The `clerk`
prop takes an existing instance instead, which is how the test below injects a stand-in, so no SDK
is loaded and nothing touches the network.

```tsx title="src/greeting.tsx" run
import { useAuth } from "@shadow-js/clerk";

export function Greeting() {
  const auth = useAuth();
  return <p>{auth.isSignedIn() ? `Signed in as ${auth.userId()}` : "Guest"}</p>;
}
```

```tsx title="src/greeting.test.tsx" test
import { type ClerkLike, ClerkProvider } from "@shadow-js/clerk";
import { flush, render } from "@shadow-js/testing/dom";
import { describe, expect, it } from "vitest";
import { Greeting } from "./greeting";

/** A flow method that does nothing and succeeds: the future sign-in and sign-up flows are stand-ins here. */
const noop = () => Promise.resolve({ error: null });

/**
 * clerk-js's private state. The provider reads it to mirror the future sign-in and sign-up flows, and reports a Clerk
 * without it. `ClerkLike` does not name it, so the stand-in attaches it with `Object.assign` below.
 */
const flowState = {
  signInSignal: () => ({
    signIn: {
      status: "needs_identifier",
      emailCode: { sendCode: noop, verifyCode: noop },
      create: noop,
      password: noop,
      sso: noop,
      reset: noop,
      finalize: noop,
    },
    errors: { fields: {}, raw: null, global: null },
    fetchStatus: "idle",
  }),
  signUpSignal: () => ({
    signUp: {
      status: "missing_requirements",
      verifications: { emailAddress: { status: null } },
      create: noop,
      update: noop,
      password: noop,
      sso: noop,
      reset: noop,
      finalize: noop,
    },
    errors: { fields: {}, raw: null, global: null },
    fetchStatus: "idle",
  }),
  __internal_effect: (callback: () => void) => {
    callback();
    return () => undefined;
  },
};

/** The smallest Clerk that is signed in as one user after `load()`. */
function signedInClerk(): ClerkLike {
  const session = { id: "sess_1", status: "active", getToken: () => Promise.resolve("jwt") };
  const listeners = new Set<(resources: object) => void>();
  const clerk: ClerkLike = {
    loaded: false,
    client: undefined,
    user: undefined,
    session: undefined,
    organization: undefined,
    async load() {
      await Promise.resolve();
      Object.assign(clerk, { loaded: true, user: { id: "user_42" }, session });
      for (const listener of listeners) listener({ user: clerk.user, session });
    },
    addListener: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signOut: () => Promise.resolve(),
    openSignIn: () => undefined,
    openSignUp: () => undefined,
    redirectToSignIn: () => Promise.resolve(),
    redirectToSignUp: () => Promise.resolve(),
    setActive: () => Promise.resolve(),
    mountSignIn: () => undefined,
    unmountSignIn: () => undefined,
    mountSignUp: () => undefined,
    unmountSignUp: () => undefined,
    mountUserButton: () => undefined,
    unmountUserButton: () => undefined,
    mountUserProfile: () => undefined,
    unmountUserProfile: () => undefined,
    mountOrganizationSwitcher: () => undefined,
    unmountOrganizationSwitcher: () => undefined,
    mountOrganizationProfile: () => undefined,
    unmountOrganizationProfile: () => undefined,
    mountCreateOrganization: () => undefined,
    unmountCreateOrganization: () => undefined,
    mountOrganizationList: () => undefined,
    unmountOrganizationList: () => undefined,
    mountWaitlist: () => undefined,
    unmountWaitlist: () => undefined,
    mountPricingTable: () => undefined,
    unmountPricingTable: () => undefined,
    handleRedirectCallback: () => Promise.resolve(undefined),
  };
  return Object.assign(clerk, { __internal_state: flowState });
}

describe("Greeting", () => {
  it("shows Guest until Clerk has loaded, then the user", async () => {
    const view = render(() => (
      <ClerkProvider publishableKey="pk_test_Y2xlcmsuZXhhbXBsZS5jb20k" clerk={signedInClerk()}>
        <Greeting />
      </ClerkProvider>
    ));
    expect(view.container.textContent).toBe("Guest");
    await flush();
    expect(view.container.textContent).toBe("Signed in as user_42");
  });
});
```

In the application the provider loads the SDK itself:

```tsx title="src/main.tsx" typecheck
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@shadow-js/clerk";
import { render } from "@shadow-js/web";

const root = document.getElementById("app");
if (root === null) throw new Error("#app is missing");

render(
  () => (
    <ClerkProvider publishableKey="pk_test_Y2xlcmsuZXhhbXBsZS5jb20k" loadOptions={{ signInUrl: "/sign-in" }}>
      <SignedOut>
        <SignInButton />
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </ClerkProvider>
  ),
  root,
);
```

`publishableKey` must start with `pk_test_` or `pk_live_`; anything else throws a `TypeError` that
does not echo the value. `loadOptions` goes to `clerk.load()` unchanged. A failed import or load is
thrown to the nearest `ErrorBoundary`, and its reset retries.

## API

Two entries: `@shadow-js/clerk` (client) and `@shadow-js/clerk/server` (server only).

| Export | Description |
| --- | --- |
| `ClerkProvider` | Loads Clerk lazily, subscribes to it, provides the state. Props: `publishableKey`, `loadOptions`, `clerk`. |
| `useAuth()` | Accessors `isLoaded`, `isSignedIn`, `userId`, `sessionId`, `orgId`, `orgRole`; functions `getToken({ template?, skipCache? })` and `signOut(options?)`. |
| `useUser()`, `useSession()`, `useOrganization()` | Accessors for the user, the session, and the active organization with the user's membership. |
| `useSignIn()`, `useSignUp()` | clerk-js's future sign-in or sign-up resource (`reset()`, `sso()`, `emailCode` ...) as an accessor, its `errors` and `fetchStatus`, and `setActive(params)`. See the guide's "Custom sign-in flows". |
| `useClerk()` | An accessor of the Clerk instance, `null` until it has loaded. |
| `SignedIn`, `SignedOut`, `Protect` | Show children by state; `Protect` also checks `role`, `permission` and a `condition`. |
| `ClerkLoading`, `ClerkLoaded`, `AuthLoading` | Show children while Clerk has not loaded, or once it has. |
| `RedirectToSignIn`, `RedirectToSignUp` | Redirect a signed-out visitor once Clerk has loaded. |
| `AuthenticateWithRedirectCallback` | Completes an OAuth or SSO redirect (`clerk.handleRedirectCallback`) on its route. |
| `SignIn`, `SignUp`, `UserButton`, `UserProfile`, `OrganizationSwitcher`, `OrganizationProfile`, `CreateOrganization`, `OrganizationList`, `Waitlist`, `PricingTable` | Mount Clerk's UI into a `<div>` (the server sends a keyed placeholder); props go to Clerk. |
| `useOrganizationList()` | Accessors `isLoaded` and `memberships` (`undefined` while loading); `setActive({ organization })`. |
| `SignInButton`, `SignUpButton`, `SignOutButton` | Open the dialog, redirect, or sign out. A child element becomes the button. |
| `clerkConvexAuth({ template? })` | Builds the `useAuth` hook for `ConvexProviderWithAuth` from `@shadow-js/convex`. |
| `ConvexProviderWithClerk` (`@shadow-js/clerk/convex`) | The Convex provider for Clerk apps: `clerkConvexAuth` wired up. Imports `@shadow-js/convex`, which the app installs. |
| `verifyWebhook(request, { secret })`, `WebhookVerificationError` (server) | Verifies a Clerk (Svix) webhook with Web Crypto and returns the event; `reason` names a failed check. |
| `createRouteMatcher(patterns)` (server) | Returns a function that says whether a path, URL or request is covered by the patterns. |
| `ClerkLike` and the `Clerk*Like` types | The structural view of the Clerk instance; implement it to fake Clerk in a test. |
| `authenticateRequest(request, options)` (server) | Verifies the token of a Web `Request`; returns `isSignedIn`, `userId`, `sessionId`, `orgId`, `orgRole`, `claims`, `reason`, `getToken`. |
| `requireAuth(request, options)` (server) | Returns the signed-in result, or throws a `302` to `signInUrl` or a `401` `Response`. |
| `clerkMiddleware(options)`, `getAuth(event)` (server) | An `(event, next)` middleware that stores the outcome per event, and its reader. |

## Server

```ts title="src/api.ts" typecheck
import { requireAuth } from "@shadow-js/clerk/server";

const keys = {
  secretKey: process.env["CLERK_SECRET_KEY"] ?? "",
  publishableKey: process.env["DUSK_PUBLIC_CLERK_KEY"] ?? "",
  authorizedParties: ["https://app.example.com"],
  signInUrl: "/sign-in",
};

export async function handleRequest(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth(request, keys);
    return Response.json({ userId: auth.userId });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}
```

- A missing, expired, forged or mis-addressed token gives a signed-out result with a `reason`; it
  does not throw. Invalid options throw a `TypeError` that names the setting and never prints its
  value. The package reads no environment variables.
- Keep the secret key on the server. Set `authorizedParties` in production: without it, a token
  minted for another application on the same Clerk instance is accepted.
- Pass the instance's PEM public key as `jwtKey` to verify tokens locally, without a request to
  Clerk's JWKS endpoint. In that mode the signature is the trust anchor: `@clerk/backend` 3.23.1
  does not compare the `iss` claim against the publishable key.

## Runtimes

`@shadow-js/clerk/server` uses Web APIs only, so it runs on Node (22.12 and later), Bun, Deno and Cloudflare Workers.
The runtime tests run the same checks in each one (webhook verification, the route matcher and the error class). Bun runs
when `bun` is on the PATH. Cloudflare Workers runs on the workerd that `wrangler` ships. Deno runs when `deno` is on the PATH
and the package is built. Otherwise each of these is skipped, and the test title says why.

## Notes

- `user()` is typed as `ClerkUserLike` (the id and the organization memberships). At run time it is
  Clerk's full user resource; narrow the value to read other fields.
- The UI components and buttons render nothing on the server; their mount happens on the client.
- `getToken` resolves `null` when there is no active session, after sign-out, and when the session
  changed while the token was being fetched. A rejected request rejects the promise.

## Links

- [Convex package](https://convex.shadowjs.net).
- Clerk documentation: https://clerk.com/docs

## Production error codes

A production build keeps a short code instead of the development explanation, so message text never reaches user bundles. Search this table for the code. In the explanation, `…` stands for a value the development message names. A code followed by a word names the option, feature or member at fault.

| Code | Development explanation |
| --- | --- |
| `CLERK_FUTURE_1` | clerk-js handed over a … resource without the future methods this package uses. The … is null. Upgrade @clerk/clerk-js to a release with the future custom-flow API (6.38.1 or later is what this package is tested with). |
| `CLERK_FUTURE_2` | @clerk/clerk-js does not expose the future sign-in and sign-up state (its private state object), so useSignIn().signIn() and useSignUp().signUp() stay null. Upgrade @clerk/clerk-js to 6.38.1 or later; the custom flow API needs it. |
| `CLERK_KEY` | publishableKey does not name a Clerk frontend API. Copy the key again from the Clerk dashboard. |
| `CLERK_MODE` | mode must be "script" or "bundled". |
| `CLERK_URL_1` | … is not a valid URL. |
| `CLERK_URL_2` | … must be https (http only for localhost). |
| `CLERK_VERSION` | … must be a version such as "6" or "6.38.1". |

## Dependencies

- Runtime: none.
- Peers: `@shadow-js/core` and `@shadow-js/web` `^1.0.0`: the runtime and rendering the auth components use.
- Optional peers: `@clerk/clerk-js` `>=5`, `@clerk/ui` `>=1.39.1`, `@clerk/backend` `>=2`: the browser SDK, the prebuilt UI (`src/provider.ts`), and server session checks (`src/server/authenticate.ts`).

## Types

- Names from the root: `ClerkUserLike`, `ClerkLike`, `AuthButtonProps`, `GuardProps`, `ProtectProps`.
- Type tests in `test-types/` are compile-time checks; `npm run typecheck:types` runs them.

## Support

- Node.js `>=22.12.0`. ESM only: use `import`; `require` is not supported.
- Browsers: current evergreen releases.
- Versioning: every `@shadow-js/*` package releases together at one version. Upgrade them as one set.
- Documentation: [ShadowJS documentation](https://shadowjs.net).

## Using, changing and contributing

- **Use the package** (a person or a coding agent that builds with it): this README, and [SKILL.md](SKILL.md), the short page an agent reads first.
- **Change the package** (fix a bug, add a feature): [AGENTS.md](AGENTS.md) says how the repository is laid out, how to implement and test a change, and how a pull request is reviewed. It is written for people and coding agents alike.
- **Take part**: [CONTRIBUTING.md](CONTRIBUTING.md) is the short guide; [SECURITY.md](SECURITY.md) is for vulnerabilities.
