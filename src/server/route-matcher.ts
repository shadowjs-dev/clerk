/**
 * Route matching for middleware: decides which request paths a rule covers, for example the
 * dashboard and everything below it. It follows the pattern syntax of Clerk's `createRouteMatcher`
 * for the forms apps use; anything else is rejected when the matcher is created.
 * @packageDocumentation
 */

/**
 * What a {@link RouteMatcher} accepts: a Web `Request`, a `URL`, or a path (with or without a query).
 * @since 1.0.0
 */
export type RouteMatchInput = Request | URL | string;

/**
 * A function that answers whether a path is covered by the patterns it was made from. {@link createRouteMatcher}
 * returns one; `protect` of {@link clerkMiddleware} takes one.
 * @since 1.0.0
 */
export type RouteMatcher = (input: RouteMatchInput) => boolean;

/**
 * Options of {@link createRouteMatcher}.
 * @since 1.0.0
 */
export interface RouteMatcherOptions {
  /**
   * Compare ASCII case exactly. Set it when the application's router is case-sensitive (Dusk's
   * `router.caseSensitive`), so `/About` is not the page of the pattern `/about`. Default `false`, the
   * router's own default: `/DASHBOARD` is the page of `/dashboard`.
   * @default false
   */
  readonly caseSensitive?: boolean;
}

/** One step of a compiled pattern. @internal */
type Token =
  | { readonly kind: "char"; readonly ch: string }
  | { readonly kind: "param" }
  | { readonly kind: "star" };

/** A segment parameter: `:name`, one path segment. @internal */
const PARAM = /^:[A-Za-z_][A-Za-z0-9_]*$/;

/** Characters that may appear in a literal path segment. Anything else is rejected. @internal */
const LITERAL = /^[A-Za-z0-9_.~%+-]*$/;

/** A character that stays raw in a path segment (RFC 3986 `pchar` without `%`): the router keeps these as they are. */
const SEGMENT_SAFE = /^[0-9A-Za-z\-._~!$&'()*+,;=:@]$/;

/** Lower-cases ASCII letters only, as the router does: `"\u212A"` (Kelvin) is not a `k`. @internal */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/**
 * Decodes the escapes of one segment once, or returns undefined when an escape is malformed. Like the router,
 * `%2F` decodes to a character inside the segment, not to a separator.
 * @internal
 */
function decodeSegment(segment: string): string | undefined {
  if (!segment.includes("%")) return segment;
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
}

/** Escapes decoded segment text the way the router's canonical form does: `/`, `%` and `\` stay escaped. @internal */
function encodeSegment(text: string): string {
  let out = "";
  for (const ch of text) out += SEGMENT_SAFE.test(ch) ? ch : encodeURIComponent(ch);
  return out;
}

/**
 * The spelling the router matches a path by: each segment decoded once and escaped again, so `/%64ashboard`
 * is `/dashboard` and `/a%2Fb` stays one segment.
 * @internal
 */
function canonicalPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    const decoded = decodeSegment(part);
    // A segment with a malformed escape stays as written: the router serves no page for the path, and the
    // other segments are still read in their canonical spelling.
    parts.push(decoded === undefined ? part : encodeSegment(decoded));
  }
  return parts.join("/");
}

/**
 * Turns one pattern into tokens. Supported: literal segments, `:name` (one segment), `*` and `(.*)`
 * (anything, including slashes), with literal text on either side of a wildcard inside a segment. Every
 * other character is rejected, so a pattern never matches more than its text says. A trailing slash is
 * dropped (the router serves `/admin/` and `/admin` as one page), literal text is compared in the router's
 * canonical spelling (see {@link canonicalPath}), and case is folded as the router folds it.
 * @internal
 */
function compile(pattern: string, caseSensitive: boolean): readonly Token[] {
  if (typeof pattern !== "string" || !pattern.startsWith("/")) {
    throw new TypeError(
      `createRouteMatcher: the pattern "${String(pattern)}" must start with "/".`,
    );
  }
  if (pattern.includes("\u0000") || pattern.includes("//")) {
    throw new TypeError(
      `createRouteMatcher: "${pattern}" has an empty segment or a control character.`,
    );
  }
  const trimmed = pattern.length > 1 && pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  const source = trimmed.replace(/\(\.\*\)|\*/g, "\u0000");
  const tokens: Token[] = [];
  const chars = (text: string): void => {
    const decoded = decodeSegment(text);
    if (decoded === undefined) {
      throw new TypeError(`createRouteMatcher: "${pattern}" has a malformed % escape.`);
    }
    const canonical = encodeSegment(decoded);
    for (const ch of caseSensitive ? canonical : asciiLower(canonical)) {
      tokens.push({ kind: "char", ch });
    }
  };
  source.split("/").forEach((part, index) => {
    if (index > 0) tokens.push({ kind: "char", ch: "/" });
    if (part === "") return;
    if (part.includes("\u0000")) {
      // Every piece between wildcards is kept: the literal text after the first wildcard is never dropped.
      part.split("\u0000").forEach((piece, at) => {
        if (!LITERAL.test(piece)) {
          throw new TypeError(
            `createRouteMatcher: "${pattern}" uses a wildcard in an unsupported place.`,
          );
        }
        if (at > 0) tokens.push({ kind: "star" });
        chars(piece);
      });
      return;
    }
    if (PARAM.test(part)) {
      tokens.push({ kind: "param" });
      return;
    }
    if (!LITERAL.test(part)) {
      throw new TypeError(
        `createRouteMatcher: "${pattern}" uses a character this matcher does not support.`,
      );
    }
    chars(part);
  });
  return tokens;
}

/**
 * Whether the tokens match the whole text. A dynamic program over (token, position) with one row per token:
 * O(tokens x length) in every case, so no pattern can make a request expensive by backtracking.
 * @internal
 */
function matches(tokens: readonly Token[], text: string): boolean {
  const n = text.length;
  let reach: Uint8Array = new Uint8Array(n + 1);
  reach[0] = 1;
  for (const token of tokens) {
    const next = new Uint8Array(n + 1);
    if (token.kind === "char") {
      for (let at = 0; at < n; at += 1) {
        if (reach[at] === 1 && text[at] === token.ch) next[at + 1] = 1;
      }
    } else if (token.kind === "star") {
      // Any run of characters, the empty one included: every position at or after a reachable one.
      let seen = false;
      for (let at = 0; at <= n; at += 1) {
        seen = seen || reach[at] === 1;
        if (seen) next[at] = 1;
      }
    } else {
      // One or more characters that are not `/`: a parameter is exactly one path segment.
      let inside = false;
      for (let at = 1; at <= n; at += 1) {
        inside = (inside || reach[at - 1] === 1) && text[at - 1] !== "/";
        if (inside) next[at] = 1;
      }
    }
    reach = next;
  }
  return reach[n] === 1;
}

/** A string that starts with a scheme is a URL; anything else is a path, even when it starts with `//` or `\`. @internal */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * The path of the input, without a query string or fragment, and without a trailing slash. A string is taken as
 * a path (or a URL) and resolved the way the server resolves it: dot segments and backslashes are resolved by
 * the URL parser, as they are for the request the router sees. A path string is never read as a host, so
 * `"//evil.example/x"` is the path `//evil.example/x`.
 * @internal
 */
function pathOf(input: RouteMatchInput): string {
  let pathname: string;
  if (typeof input === "string") {
    const url = SCHEME.test(input)
      ? new URL(input)
      : new URL(`http://localhost${input.startsWith("/") ? "" : "/"}${input}`);
    pathname = url.pathname;
  } else if (input instanceof URL) pathname = input.pathname;
  else pathname = new URL(input.url).pathname;
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * The spelling of a path the matcher checks: the router's canonical form (see {@link canonicalPath}), with
 * case folded as the router folds it. The router serves `/%64ashboard` and `/DASHBOARD` as `/dashboard`, so a
 * rule must cover them; it serves `/tasks%2F7` as one segment, so a `/tasks/:id` rule must not.
 * @internal
 */
function spellingOf(path: string, caseSensitive: boolean): string {
  const text = canonicalPath(path);
  return caseSensitive ? text : asciiLower(text);
}

/**
 * Makes a matcher for a list of patterns. A path matches when any pattern matches it. Patterns are
 * checked when the matcher is created, so a mistake fails at startup rather than in a request.
 *
 * Supported syntax: `/about` (exact), `/dashboard(.*)` (prefix, the section and everything below it),
 * `/tasks/:id` (one segment), `/api/*` (anything). Brackets, optional groups and other regular
 * expression syntax are rejected.
 *
 * Matching follows the router, not the text of the URL: a path is compared in the spelling the router
 * canonicalizes it to (escapes decoded once, `%2F` kept inside its segment, ASCII case folded, one trailing
 * slash ignored, dot segments and backslashes resolved by the URL parser). `/dashboard/*` does not cover
 * `/dashboard` itself; write `/dashboard(.*)` for the section and its index. The pattern sees the whole
 * pathname, a `basePath` included.
 *
 * @param patterns At least one pattern, each starting with `/`.
 * @param options Case sensitivity; see {@link RouteMatcherOptions}.
 * @returns A {@link RouteMatcher}.
 * @throws TypeError when the list is empty or a pattern is not supported (no leading `/`, an empty segment, a
 *   malformed `%` escape, or a character outside the supported syntax). The message starts with `createRouteMatcher:`.
 * @example
 * ```ts
 * import { createRouteMatcher, requireAuth } from "@shadow-js/clerk/server";
 *
 * const isProtected = createRouteMatcher(["/dashboard(.*)", "/admin(.*)"]);
 *
 * const options = {
 *   secretKey: process.env["CLERK_SECRET_KEY"] ?? "",
 *   publishableKey: process.env["DUSK_PUBLIC_CLERK_KEY"] ?? "",
 *   authorizedParties: ["https://app.example.com"],
 *   signInUrl: "/sign-in",
 * };
 *
 * export async function guard(request: Request): Promise<void> {
 *   if (isProtected(request)) await requireAuth(request, options);
 * }
 * ```
 * @see {@link clerkMiddleware}
 * @since 1.0.0
 */
export function createRouteMatcher(
  patterns: readonly string[],
  options: RouteMatcherOptions = {},
): RouteMatcher {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new TypeError("createRouteMatcher: give at least one pattern.");
  }
  const caseSensitive = options.caseSensitive === true;
  const expressions = patterns.map((pattern) => compile(pattern, caseSensitive));
  return (input) => {
    const text = spellingOf(pathOf(input), caseSensitive);
    return expressions.some((tokens) => matches(tokens, text));
  };
}
