import type { ClerkConstructor, ClerkLike, ClerkLoadOptions } from "../types";

/**
 * Loads the Clerk SDK from the app's bundle, for the `bundled` mode of `ClerkProvider` only. The
 * dynamic import is a lazy chunk: an app that uses the script mode never requests it, and importing
 * this package on the server never loads it. A failed import rejects, and the next mount tries again.
 * @internal
 */
export function importClerkConstructor(): Promise<ClerkConstructor> {
  return import("@clerk/clerk-js").then((module) => module.Clerk);
}

/**
 * Loads the UI bundle of `@clerk/ui` for the `bundled` mode. `clerk.load()` refuses to finish without
 * it ("Clerk was not loaded with Ui components"), so every mounted Clerk component depends on it. The
 * package is an optional peer; a missing one is reported by name.
 * @internal
 */
export function importClerkUi(): Promise<unknown> {
  return import("@clerk/ui")
    .then((module) => module.ui.ClerkUI)
    .catch(async (error: unknown) => {
      const texts = await import("./script-errors");
      throw texts.uiPackageError(error);
    });
}

/**
 * The options for `clerk.load()`: the caller's options with the UI bundle added. A `ui` object the
 * caller passed is kept, and its own `ClerkUI` wins over the one loaded here.
 * @internal
 */
export function withClerkUi(
  loadOptions: ClerkLoadOptions | undefined,
  ClerkUI: unknown,
): ClerkLoadOptions {
  const given = loadOptions?.["ui"];
  const ui = typeof given === "object" && given !== null ? given : {};
  return { ...loadOptions, ui: { ClerkUI, ...ui } };
}

/**
 * The pending or finished `clerk.load()` of each instance. Several providers may mount around one
 * `window.Clerk` (script mode), and clerk-js does its setup once: the second caller gets the same
 * promise instead of a second `load()`. A failed load is forgotten, so the next mount retries it.
 * @internal
 */
const loads = new WeakMap<ClerkLike, Promise<void>>();

/**
 * Calls `clerk.load(options)` once per instance, see {@link loads}.
 * @internal
 */
export function loadInstance(
  clerk: ClerkLike,
  options: ClerkLoadOptions | undefined,
): Promise<void> {
  const pending = loads.get(clerk);
  if (pending !== undefined) return pending;
  const started = clerk.load(options).catch((error: unknown) => {
    loads.delete(clerk);
    throw error;
  });
  loads.set(clerk, started);
  return started;
}
