import type { ClerkLike } from "../types";
import { scriptClerkUI } from "./private-api";
import type { ScriptFailure } from "./script-errors";

/**
 * The script mode of `ClerkProvider`: Clerk's own browser bundles, `clerk.browser.js` (the SDK) and
 * `ui.browser.js` (the components), loaded as classic `<script>` elements from Clerk's frontend API
 * host. `@clerk/react` and `@clerk/nextjs` load them the same way, so the bundles cache across the
 * sites that share the host, and the app's own bundle carries neither.
 * @packageDocumentation
 */

/** The major line of `@clerk/clerk-js` the script mode loads by default: the line this package is tested against. */
export const CLERK_JS_MAJOR = "6";
/** The major line of `@clerk/ui` the script mode loads by default (`@clerk/clerk-js` 6 needs `@clerk/ui` >= 1.39.1). */
export const CLERK_UI_MAJOR = "1";
/** How long a script may take to define its global before the load counts as failed. */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 15_000;

/** Attempts per script: the first load and one retry. */
const ATTEMPTS = 2;
/** How often a pending load checks whether its global has appeared. */
const POLL_MS = 50;

/** The shape of a Clerk publishable key; the frontend API is the base64 text after the prefix. */
const KEY_PATTERN = /^pk_(?:test|live)_([A-Za-z0-9+/_=-]+)$/;
/** A frontend API host: at least two DNS labels and a last label that starts with a letter (so never an IP address, `127.1` or `0x7f.1`). */
const HOST_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*$/i;
/** A version or dist-tag as it may appear in a URL path: `6`, `6.38.1`, `canary`. */
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

/**
 * The script URL overrides a provider accepts. Each one replaces the derived URL or the derived version. Part of
 * `ClerkProviderProps`; script mode only.
 * @internal
 */
export interface ScriptOverrides {
  /**
   * A full `https` URL of `clerk.browser.js`, used as given (for example a copy on your own origin for a strict
   * policy). `http` is accepted for `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` and the page's own origin only.
   * A relative URL resolves against the page. Any other URL fails the load with a `TypeError`. Without it the URL is
   * `https://<frontend API host>/npm/@clerk/clerk-js@<clerkJSVersion>/dist/clerk.browser.js`.
   */
  readonly clerkJSUrl?: string | undefined;
  /**
   * The `@clerk/clerk-js` version or tag in the derived URL: up to 64 letters, digits, `.`, `+` and `-`, such as `6`
   * or `6.38.1`. Anything else fails the load with a `TypeError`. Not used with `clerkJSUrl`.
   * @default "6"
   */
  readonly clerkJSVersion?: string | undefined;
  /**
   * A full `https` URL of `ui.browser.js`, used as given; the same rule as `clerkJSUrl`. Without it the URL is
   * `https://<frontend API host>/npm/@clerk/ui@<clerkUIVersion>/dist/ui.browser.js`.
   */
  readonly clerkUIUrl?: string | undefined;
  /**
   * The `@clerk/ui` version or tag in the derived URL; the same rule as `clerkJSVersion`. Not used with `clerkUIUrl`.
   * @default "1"
   */
  readonly clerkUIVersion?: string | undefined;
}

/**
 * Reads the frontend API host out of a publishable key. A key is `pk_test_` or `pk_live_` followed
 * by the base64 of `<host>$`, so a custom domain (`clerk.example.com`) and a development instance
 * (`bright-otter-42.clerk.accounts.dev`) both come out as plain hosts. The error never echoes the key.
 * @param publishableKey A key that already passed the shape check of the provider.
 * @returns The host, without a scheme and without the trailing `$`.
 * @throws {TypeError} When the key does not encode a frontend API host.
 * @internal
 */
export function frontendApiOf(publishableKey: string): string {
  const encoded = KEY_PATTERN.exec(publishableKey)?.[1];
  let decoded = "";
  if (encoded !== undefined) {
    try {
      decoded = atob(base64WithPadding(encoded));
    } catch {
      decoded = "";
    }
  }
  const host = decoded.endsWith("$") ? decoded.slice(0, -1) : "";
  if (!HOST_PATTERN.test(host)) {
    throw new TypeError(
      "ClerkProvider: publishableKey does not name a Clerk frontend API. Copy the key again from the Clerk dashboard.",
    );
  }
  return host;
}

/** Base64 (the URL-safe alphabet allowed, padding optional) in the form `atob` reads. */
function base64WithPadding(encoded: string): string {
  const standard = encoded.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  return standard + "=".repeat((4 - (standard.length % 4)) % 4);
}

/**
 * The URL of `clerk.browser.js`: the override as given, or the derived URL on the frontend API host.
 * @internal
 */
export function clerkJSScriptUrl(host: string, overrides: ScriptOverrides): string {
  if (overrides.clerkJSUrl !== undefined) return overrides.clerkJSUrl;
  const version = versionOf("clerkJSVersion", overrides.clerkJSVersion, CLERK_JS_MAJOR);
  return `https://${host}/npm/@clerk/clerk-js@${version}/dist/clerk.browser.js`;
}

/**
 * The URL of `ui.browser.js`: the override as given, or the derived URL on the frontend API host.
 * @internal
 */
export function clerkUIScriptUrl(host: string, overrides: ScriptOverrides): string {
  if (overrides.clerkUIUrl !== undefined) return overrides.clerkUIUrl;
  const version = versionOf("clerkUIVersion", overrides.clerkUIVersion, CLERK_UI_MAJOR);
  return `https://${host}/npm/@clerk/ui@${version}/dist/ui.browser.js`;
}

function versionOf(prop: string, given: string | undefined, fallback: string): string {
  const version = given ?? fallback;
  if (!VERSION_PATTERN.test(version)) {
    throw new TypeError(`ClerkProvider: ${prop} must be a version such as "6" or "6.38.1".`);
  }
  return version;
}

/**
 * Whether a value has the members this package calls on a Clerk instance. Only members are read,
 * so the real `Clerk` and a hand-written fake both pass.
 * @internal
 */
export function isClerkLike(value: unknown): value is ClerkLike {
  if (typeof value !== "object" || value === null) return false;
  const members = value as Readonly<Record<string, unknown>>;
  return (
    "loaded" in members &&
    typeof members["load"] === "function" &&
    typeof members["addListener"] === "function"
  );
}

/** A global the Clerk bundles define, read without an `any` cast. */
function windowGlobal(name: string): unknown {
  return (window as unknown as Readonly<Record<string, unknown>>)[name];
}

/** The inputs of {@link loadClerkScripts}. */
export interface ScriptLoadOptions extends ScriptOverrides {
  readonly publishableKey: string;
  /** Written to both script elements, so a strict `script-src` with a nonce allows them. */
  readonly nonce?: string | undefined;
  /** How long each script may take, in milliseconds. */
  readonly timeoutMs?: number | undefined;
  /** Aborts pending loads (the provider was unmounted). */
  readonly signal: AbortSignal;
}

/** What the script mode hands the provider: the instance clerk.browser.js created and the UI constructor. */
export interface LoadedClerk {
  readonly clerk: ClerkLike;
  readonly ClerkUI: unknown;
}

/**
 * Loads Clerk's two browser bundles and returns the instance they create.
 *
 * clerk.browser.js reads the key from its own `data-clerk-publishable-key` attribute and sets
 * `window.Clerk` to an instance (it exports no constructor). ui.browser.js defines the UI
 * constructor, which `clerk.load({ ui: { ClerkUI } })` takes (see `scriptClerkUI`). The two load in
 * parallel. A global that already exists is used as it is, and a script that another copy of this
 * package already inserted is awaited instead of inserted again.
 * @param options See {@link ScriptLoadOptions}.
 * @returns The Clerk instance and the UI constructor, once both globals are defined.
 * @throws {Error} When a script fails to load, or does not define its global, after one retry.
 * @internal
 */
export async function loadClerkScripts(options: ScriptLoadOptions): Promise<LoadedClerk> {
  const host = frontendApiOf(options.publishableKey);
  const shared = {
    nonce: options.nonce,
    timeoutMs: options.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
    signal: options.signal,
  };
  // Both URLs are checked before either script is inserted: a bad second URL must not leave the first one loading.
  const jsUrl = httpUrl("clerkJSUrl", clerkJSScriptUrl(host, options));
  const uiUrl = httpUrl("clerkUIUrl", clerkUIScriptUrl(host, options));
  await Promise.all([
    ensureScript({
      ...shared,
      marker: "data-clerk-js-script",
      label: "clerk.browser.js",
      url: jsUrl,
      attributes: { "data-clerk-publishable-key": options.publishableKey },
      ready: () => isClerkLike(windowGlobal("Clerk")),
    }),
    ensureScript({
      ...shared,
      marker: "data-clerk-ui-script",
      label: "ui.browser.js",
      url: uiUrl,
      attributes: {},
      ready: () => scriptClerkUI() !== undefined,
    }),
  ]);
  const clerk = windowGlobal("Clerk");
  if (!isClerkLike(clerk)) throw (await import("./script-errors")).missingGlobalError();
  // window.Clerk is one instance per page. A different key already loaded here would be used silently.
  const loadedKey = (clerk as unknown as Readonly<Record<string, unknown>>)["publishableKey"];
  if (typeof loadedKey === "string" && loadedKey !== options.publishableKey) {
    const texts = await import("./script-errors");
    throw texts.otherKeyError();
  }
  return { clerk, ClerkUI: scriptClerkUI() };
}

/**
 * Checks a script URL: `https:`, or `http:` for the machine itself (`localhost`) and for the page's own origin
 * (a development server). A relative URL resolves against the page. The URL is the one the developer wrote; a
 * `javascript:`, `data:` or foreign plain-http URL, which a value copied from the query string could be, is refused.
 */
function httpUrl(prop: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value, window.location.href);
  } catch {
    throw new TypeError(`ClerkProvider: ${prop} is not a valid URL.`);
  }
  const own =
    /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(url.hostname) ||
    url.origin === window.location.origin;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && own)) {
    throw new TypeError(`ClerkProvider: ${prop} must be https (http only for localhost).`);
  }
  return url.href;
}

/** One script of the script mode, as {@link ensureScript} loads it. */
interface ScriptSpec {
  readonly label: string;
  readonly url: string;
  /** The attribute that marks the element this package inserted, so a second copy can find it. */
  readonly marker: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly nonce: string | undefined;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** True once the script's global is defined. */
  readonly ready: () => boolean;
}

/** Loads one script, retrying once. Resolves at once when its global is already defined. */
async function ensureScript(spec: ScriptSpec): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    if (spec.signal.aborted) throw await failureOf("canceled", spec, hostOf(spec));
    if (spec.ready()) return;
    try {
      await loadOnce(spec);
      return;
    } catch (error) {
      if (spec.signal.aborted) throw await failureOf("canceled", spec, hostOf(spec));
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * One attempt. It inserts the script, or waits for a copy already in the document, and settles when
 * the global appears, the script errors, or the timeout passes. Every path clears its timers and
 * listeners. A failed or canceled attempt removes its element, so the retry inserts a fresh one.
 */
function loadOnce(spec: ScriptSpec): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const host = new URL(spec.url).host;
    const existing = document.querySelector<HTMLScriptElement>(`script[${spec.marker}]`);
    const script = existing ?? createScript(spec);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;

    const settle = (failure?: ScriptFailure): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (poll !== undefined) clearInterval(poll);
      spec.signal.removeEventListener("abort", onAbort);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (failure === undefined) {
        resolve();
        return;
      }
      script.remove();
      failureOf(failure, spec, host).then(reject, reject);
    };
    const onAbort = (): void => settle("canceled");
    const onLoad = (): void => {
      if (spec.ready()) settle();
      else settle("missingGlobal");
    };
    const onError = (): void => settle("loadFailed");

    spec.signal.addEventListener("abort", onAbort);
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    timer = setTimeout(() => settle("timeout"), spec.timeoutMs);
    poll = setInterval(() => {
      if (spec.ready()) settle();
    }, POLL_MS);
    if (existing === null) document.head.append(script);
  });
}

function createScript(spec: ScriptSpec): HTMLScriptElement {
  const script = document.createElement("script");
  script.src = spec.url;
  script.async = true;
  script.crossOrigin = "anonymous";
  script.setAttribute(spec.marker, "");
  for (const [name, value] of Object.entries(spec.attributes)) script.setAttribute(name, value);
  if (spec.nonce !== undefined && spec.nonce !== "") {
    script.nonce = spec.nonce;
    script.setAttribute("nonce", spec.nonce);
  }
  return script;
}

/**
 * The error of a failed attempt. Its text is in `script-errors.ts`, which only this path loads, so the
 * prose stays out of a page whose scripts load.
 */
async function failureOf(kind: ScriptFailure, spec: ScriptSpec, host: string): Promise<Error> {
  const texts = await import("./script-errors");
  return texts.scriptFailure(kind, { label: spec.label, host, timeoutMs: spec.timeoutMs });
}

function hostOf(spec: ScriptSpec): string {
  return new URL(spec.url).host;
}
