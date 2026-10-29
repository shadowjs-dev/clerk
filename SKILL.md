---
name: shadowjs-clerk
description: "Work with @shadow-js/clerk. Clerk authentication for your app, with a provider, hooks, UI components and server helpers. Use when a project imports it, or when asked to add, configure or debug it."
---

# @shadow-js/clerk

Version 1.0.2. Clerk authentication for your app, with a provider, hooks, UI components and server helpers.

## Where to read more

- @shadow-js/clerk: https://clerk.shadowjs.net
- Source and issues: https://github.com/shadowjs-dev/clerk
- The package README is the full reference for options and behavior; read it before changing a configuration.

## Install

```sh
npm install @shadow-js/clerk @shadow-js/core @shadow-js/web
```

## Peer dependencies

| Package | Range | Required |
| --- | --- | --- |
| `@clerk/backend` | `>=2` | no |
| `@clerk/clerk-js` | `>=5` | no |
| `@clerk/ui` | `>=1.39.1` | no |
| `@shadow-js/convex` | `^1.0.2` | no |
| `@shadow-js/core` | `^1.0.2` | yes |
| `@shadow-js/web` | `^1.0.2` | yes |

## Import paths

Import only from these paths. Never from `dist` or `src`: files that are not listed here are private and change without notice.

- `@shadow-js/clerk`
- `@shadow-js/clerk/server`
- `@shadow-js/clerk/convex`

## Quick start

```tsx
import { useAuth } from "@shadow-js/clerk";

export function Greeting() {
  const auth = useAuth();
  return <p>{auth.isSignedIn() ? `Signed in as ${auth.userId()}` : "Guest"}</p>;
}
```

## Working rules

- Run `npm run check` before proposing a change; it lints, builds, type-checks and tests.
- Keep a public change documented: TSDoc on every exported symbol, and a CHANGELOG entry.
- To change this repository rather than use the package, read AGENTS.md: the layout, the commands, the rules and how a pull request is reviewed.
