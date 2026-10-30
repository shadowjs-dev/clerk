# Changelog

## 1.0.4

### Changed

- Released at 1.0.4 with the other packages, which share one version. No change to this package.

## 1.0.3

### Fixed

- `ConvexProviderWithClerk` and `clerkConvexAuth` register a new token fetcher with Convex when the user, session, organization or organization role changes, so the socket no longer keeps the old account or organization claims until the token expires; sign-out still clears auth.
- `useReverification` resolves to the original `Response` (body unread) instead of its parsed body; it reads a clone only to look for the reverification hint, so a 204 or non-JSON success no longer rejects after the side effect ran.

## 1.0.2

### Fixed

- `clerkMiddleware`'s `protect` no longer redirects the sign-in page itself to the sign-in page when the matcher covers it (a matcher such as `/(.*)`), which looped with a `redirect_url` that grew on every hop.
- `ClerkProvider`: a throw while the loaded state is applied is routed to the nearest `ErrorBoundary` instead of becoming an unhandled rejection.
- `withAnswerHeaders` no longer throws for a `101` upgrade response: the headers are set in place, or the response goes out as it is when they are immutable.
- Script mode: a provider that is unmounted no longer removes a script element another provider is still waiting on.
- `ClerkProvider`'s cross-tab session channel is named from a hash of the whole publishable key, not its last 16 characters, so two instances whose keys end alike no longer wake each other's tabs.

## 1.0.1

### Changed

- Released at 1.0.1 with the other packages, which share one version. No change to this package.

## 1.0.0

### Added

- Clerk providers, reactive authentication hooks and UI components.
- Script and bundled loading modes with server placeholders and client hydration.
- Configuration validation and guarded redirect handling.
