import { createConfig } from "./build/tsdown-preset.mjs";

// `@shadow-js/clerk/convex` imports `@shadow-js/convex`, which the Convex app installs itself. It is
// kept external so the build never bundles a second copy of the Convex runtime (its contexts would
// not match the app's providers). It is not a declared peer, so Clerk-only projects need no Convex.
const EXTERNAL = ["@shadow-js/convex"];

export default createConfig({
  packageDir: import.meta.dirname,
  entries: { index: "src/index.ts", server: "src/server.ts", convex: "src/convex-react.ts" },
}).map((config) => ({ ...config, deps: { neverBundle: [...EXTERNAL] } }));
