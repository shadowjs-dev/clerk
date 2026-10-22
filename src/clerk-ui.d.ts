/**
 * Ambient shape of the optional peer `@clerk/ui`: the one export the package reads. The package
 * does not install it; the application does, next to `@clerk/clerk-js`.
 */
declare module "@clerk/ui" {
  /** The UI bundle that `clerk.load({ ui: { ClerkUI } })` takes. */
  export const ui: { readonly ClerkUI: unknown };
}
