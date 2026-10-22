# AGENTS.md: working on clerk

This file is for anyone who changes this repository, people and coding agents alike. It says how the repository is laid out, how to implement
and test a change, and how a pull request is reviewed. To **use** the released package, read [README.md](README.md) and [SKILL.md](SKILL.md)
instead; to take part in the project, read [CONTRIBUTING.md](CONTRIBUTING.md).

Clerk integration: sessions, components and route protection.

## What is in this repository

| Package | Folder | What it is | Documentation |
| --- | --- | --- | --- |
| `@shadow-js/clerk` | `.` | Clerk authentication for your app, with a provider, hooks, UI components and server helpers | https://clerk.shadowjs.net |

The repository is the package: `@shadow-js/clerk`. Source and issues:
https://github.com/shadowjs-dev/clerk. Every package of the project has the same version number.

## Set up

You need Node.js 22.12 or newer and npm (pnpm and Yarn are not used).

The tests also need:

- `bun`: the tests run against it.
- `deno`: the tests run against it.
- `wrangler`: the tests run against it.

A test whose tool or account is missing **fails** with instructions; it is never skipped.

```sh
npm install
npm run check   # lint, build, type check and every test
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run lint` | Biome: lint and format check (`npx biome check --write <path>` fixes what it can) |
| `npm run build` | builds the package with tsdown |
| `npm run typecheck` | TypeScript 7 in strict mode, tests included |
| `npm test` | unit, DOM and server tests (Vitest) |
| `npx vitest run <path>` | one test file |
| `npm run test:gc` | memory and leak tests |
| `npm run test:perf` | wall-clock budgets; run alone, never in parallel with other work |
| `npm run check` | all of the above; a change is ready when it passes |

## Layout

- `.github/`: workflows, issue and pull request templates, code owners.
- `build/`: the shared tsdown preset every package build uses.
- `scripts/`: build and release scripts; `release.mjs` is run by the workflows.
- `src/`: the source of the package; one folder per concern, `index.ts` re-exports the public API. Folders: `components/`, `internal/`, `server/`.
- `test/`: the tests; one file per behavior, each test named by an invariant id such as `[ROUTER-12]`.
- `test-types/`: type-level tests: what the package promises to the compiler of its users.
- `types/`: ambient declarations shared with the build.
- `CHANGELOG.md`: what each release changed.
- `biome.json`: lint and format rules.
- `package.json`: the manifest; `version` is changed only by a release.
- `tsconfig.json`: type check of the source.
- `tsconfig.test-types.json`: type check of `test-types/`.
- `tsdown.config.mjs`: the build.
- `vitest.config.ts`: the test projects (unit, DOM, server, gc, perf).
- `vitest.setup.ts`: test setup: an unasserted `console.warn` or `console.error` fails a test.

## How to implement a change

1. **Find where the behavior lives.** Search `test/` and `src/` for the name of the behavior or its invariant id, then read the source the tests exercise. The invariants below say what must stay true.
2. **Write the failing test first.** A bug fix reproduces the bug; a feature states the behavior it promises. Name the test with an invariant id in square brackets, the way the neighboring tests do, then the behavior in words. The test asserts what the code does and is never skipped, marked as todo or marked as an expected failure.
3. **Make it pass with the smallest change** that keeps the invariants. Match the code around it.
4. **Keep the surface honest.** A public symbol has TSDoc (summary, parameters, return value, an example and `@since`). An error says what happened and how to fix it. User-visible behavior gets a documentation update and a line under `## Unreleased` in CHANGELOG.md.
5. **Run `npm run check`** and read its output; do not report a change as done without it passing.

### Rules every change keeps

- No `any`, `@ts-ignore` or non-null assertion. Use `unknown` and narrow.
- Compare indices, lengths and counts explicitly (`=== undefined`, `=== -1`, `> 0`), never by truthiness.
- No empty `catch`: every catch rethrows, passes the error to the owner's handler, or reports it. Every "set the current X" register is restored in `finally`.
- User callbacks run untracked unless the API says otherwise. No stack parsing, no `fn.name` sniffing, no flags stamped on user functions.
- Traversals whose depth the user controls are iterative. Caches, queues and recursion are bounded, and a test hits the bound.
- Code meant for development only sits behind `__DEV__`. No import-time side effects and no module-level mutable state beyond the registers the core owns (bounded caches and `WeakMap`s excepted).
- No sleeps in tests (flush the scheduler); a `console.warn` or `console.error` that a test does not assert fails the test. Property tests use `fast-check` with a fixed seed.
- Files are kebab-case, tests are `*.test.ts`, internals live in `src/internal/`. American English in code, comments and documentation. Comments explain why, not what.
- The reactive core and the DOM renderer have no runtime dependencies.

## Pull requests

1. **Open an issue first** for anything that adds or changes public API, behavior, supported platforms or dependencies. A small fix needs no issue.
2. **Fork, then branch from `main`** (`fix/<topic>`, `feat/<topic>`, `docs/<topic>`). One concern per pull request.
3. **Commit in small steps** with a message that says what changed and why: a short type prefix (`fix:`, `feat:`, `docs:`, `test:`, `chore:`), then the subject. Commit under your own identity; do not add trailers or notes about tools.
4. **Open the pull request against `main`** and fill in the template: what changes, why, and the checks you ran. The CI workflow (`.github/workflows/ci.yml`) runs lint, build, type check and all tests; it must be green.
5. **Review.** A maintainer (see `.github/CODEOWNERS`) reviews every pull request. Expect questions about the test, the public surface and the error messages. Push fixes to the same branch; the pull request is squash-merged.
6. **Releases are not part of a pull request.** Do not change `version`, `.github/workflows/release.yml` or `scripts/release.mjs`, and do not create tags or publish. A maintainer releases by renaming `## Unreleased` in the changelog to the version and pushing a version that is not yet on npm to `main`; the workflow publishes it with provenance.

Security problems never go in a public issue or pull request: follow [SECURITY.md](SECURITY.md).

## Architecture and invariants

What each package keeps true. A change that breaks one of these is a bug in the change.

Package-specific rules:

- Two loaders, chosen by `ClerkProvider`'s `mode` (default `script`). Script mode (`src/internal/script.ts`) inserts
  `clerk.browser.js` and `ui.browser.js` as `<script>` elements from the frontend API host of the key, and reads
  `window.Clerk`. Bundled mode (`src/internal/load.ts`) imports `@clerk/clerk-js` and `@clerk/ui` with `import()`.
  Both start only from an `onMount` effect in `ClerkProvider`. Importing the package on the server must never load
  anything or touch `window`/`document` (checked by `test/ssr.server.test.ts` and `test/script.server.test.ts`).
  Script mode must not import `@clerk/clerk-js` or `@clerk/ui` (`test/script-mode.dom.test.ts`, CDN-10).
- `ClerkLike` (`src/types.ts`) is the only Clerk surface the package depends on. Its option parameters are
  `object` on purpose: the real SDK's props types are narrower and only match under bivariance. The real
  `Clerk` class must stay assignable to it (`test/types.test.ts`, checked by `tsc`).
- `clerk()` in the context is non-null only once Clerk has loaded. Components never mount or call into an
  instance that is not ready.
- A Clerk event applies user, session, organization, client and the loaded flag in one `batch`.
- Errors from load, listeners and actions go to `ClerkContextValue.fail`. The provider throws them from an
  effect it owns, so the nearest `ErrorBoundary` catches them. Do not throw from a memo that an ErrorBoundary
  reads (its insert runs outside the boundary's scope).
- `getToken` resolves `null` for no active session, after sign-out, and when the session id changed while
  the request was in flight. A rejected SDK call rejects; it is never swallowed.
- Server helpers never log, print or return the secret key, and never echo option values in errors.
  `authorizedParties` and `jwtKey` are validated when a helper is called.
- `tsconfig.json` sets `skipLibCheck`: the Clerk SDK's own typings do not compile under
  `exactOptionalPropertyTypes`. Our code is still fully checked.
- `@shadow-js/clerk/convex` (`src/convex-react.ts`) is the only entry that imports `@shadow-js/convex`.
  That import stays external in the build (`tsdown.config.mjs`) and is not a declared peer, so
  `FRAMEWORK_REQUIRES` in `create-shadow-app` does not make Convex a Clerk requirement.
- Server placeholders (`src/internal/placeholder.ts`): every server render of a Clerk screen or default
  button takes exactly one hydration key, at the same point of the render as the browser's claim. Change
  either side only together with `test/hydrate.dom.test.ts` and `test/ssr.server.test.ts`.
- `verifyWebhook` uses Web Crypto only (no Node `crypto` import), so the same module runs in every runtime.
- Server redirects are limited to what Clerk's frontend API needs (`handshakeTargetAllowed`), a pending session is not
  signed in, and request size and unknown-`kid` lookups are bounded (`request-guard.ts`). The security tests
  (`test/security2-*`) pin each rule.
- `createRouteMatcher` compares the router's canonical spelling of a path (`test/security2-route-matcher.server.test.ts`
  fuzzes it against the real router matcher). Change it only together with that fuzz.
- Script mode never inserts a script before both URLs are checked, and an `http:` override must be local.
- `Waitlist` and `PricingTable` (`src/components/waitlist.ts`, `src/components/pricing-table.ts`) mount through
  `mountClerkUi` like the other UI components. `mountWaitlist`, `unmountWaitlist`, `mountPricingTable` and
  `unmountPricingTable` are required `ClerkLike` members with `object` options (`ClerkWaitlistOptions`,
  `ClerkPricingTableOptions`); tests in `test/waitlist.dom.test.ts`, `test/pricing-table.dom.test.ts` and
  `test/waitlist-pricing-table.server.test.ts` pin them.
- `mountClerkUi` records a node as mounted only after `spec.mount` returns. A mount that threw (for example, an older
  clerk-js without the method) is never unmounted later (`WL-12`), and a replaced instance is cleared before its
  unmount runs.
- Headless flows (`test/flows.dom.test.ts`, `FLW-*`) script the resource methods of the fake so they act as clerk-js does,
  then assert only what the hooks expose: `errors()` after a failed step, `fetchStatus()` `fetching` then `idle` (also after
  a rejection), `setActive` called with the session, and a rejected call still rejecting. Extend `test/support/fake-clerk.ts`
  by addition only: a new member or option, never a changed default that an existing test reads.
- `ClerkSignInFuture.resetPasswordEmailCode` (`src/types.ts`) mirrors clerk-js 6.38.1's member of the same name. Any type
  change of a clerk-js future member must keep the real resource assignable (`test/types.test.ts`, TYP-05 and TYP-06).
- The server sources (`src/server.ts`, `src/server/*.ts`) use Web APIs only. `RTM-05` fails on a Node built-in, `process`,
  `Buffer` or `require` in code (comments are ignored). `test/support/runtime-checks.ts` imports nothing and takes the
  server module as a parameter, so each runtime probe (`runtime-bun.mjs`, `runtime-deno.mjs`, `runtime-worker.mjs`) runs the
  same checks. A probe reports its runtime name, so a result cannot come from another runtime. The Deno probe loads
  `dist/prod/server.js`: build the package before that test runs. The Workers probe is bundled for the Workers conditions
  and served by the workerd of the installed wrangler (`test/runtimes.server.test.ts`, `RTM-04`).

## Where to look next

- [README.md](README.md): what the package does and every option.
- [SKILL.md](SKILL.md): how to use the released package (install, import paths, a quick start).
- [CONTRIBUTING.md](CONTRIBUTING.md): the short guide to taking part.
- [CHANGELOG.md](CHANGELOG.md): what each release changed.
- [ShadowJS hub](https://github.com/shadowjs-dev/shadow): every repository of the project.
