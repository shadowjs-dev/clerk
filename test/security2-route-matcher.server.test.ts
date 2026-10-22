import { createMatcher, type RouteDefinition } from "@shadow-js/router/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRouteMatcher } from "../src/server/route-matcher";

/**
 * PASS 2, scope A (Clerk): the route matcher against the Dusk router.
 *
 * The invariant that matters: a page the router serves for some spelling of the URL must be covered by the
 * matcher for that same spelling. The oracle is the real router matcher (`@shadow-js/router/core`), which
 * decides which page a pathname serves. Every case here builds a `Request` the way the middleware receives it,
 * so the WHATWG URL parser has already resolved dot segments and backslashes.
 */

const PROPS = { seed: 20261010, numRuns: 4000 } as const;

const ORIGIN = "https://app.example.com";

/** The pages of the application under test. `P:` pages need a session; `public:` pages do not. */
const TREE: readonly RouteDefinition[] = [
  { id: "P:dashboard", path: "/dashboard" },
  { id: "P:dashboard-settings", path: "/dashboard/settings" },
  { id: "P:dashboard-any", path: "/dashboard/*rest" },
  { id: "P:user", path: "/admin/users/:id" },
  { id: "public:about", path: "/about" },
  { id: "public:tasks-id", path: "/tasks/:id" },
  { id: "public:slug", path: "/:slug" },
];

const PROTECT = ["/dashboard(.*)", "/admin/users/:id"] as const;
const PUBLIC = ["/about", "/tasks/:id"] as const;

/** The page the router serves for a URL, or undefined. */
function servedBy(router: ReturnType<typeof createMatcher>, url: URL): string | undefined {
  return router.match(url.pathname).at(-1)?.id;
}

const BASES: readonly (readonly string[])[] = [
  ["dashboard"],
  ["dashboard", "settings"],
  ["dashboard", "a", "b"],
  ["admin", "users", "42"],
  ["about"],
  ["tasks", "7"],
];

/** How one character is spelled: as is, upper-cased, or percent-encoded in either hex case. */
const charOp = fc.constantFrom("keep", "keep", "upper", "pct", "pctLower");
const separator = fc.constantFrom(
  "/",
  "/",
  "/",
  "//",
  "/./",
  "/x/../",
  "/%2e/",
  "/%2E%2E/y/",
  "/;p=1/",
  "/\\",
  "/%2F",
  "/%5C",
  "/%2f",
);
const lead = fc.constantFrom("/", "/", "/", "/./", "/%2e%2e/", "/a/../", "//", "/\\");
const tail = fc.constantFrom(
  "",
  "",
  "",
  "/",
  "//",
  ";a=b",
  "%00",
  "\\",
  "%5C",
  "%2F",
  "%252F",
  "/.",
  "/..",
  "/%2e",
  "#frag",
  "?q=1",
  "\u0000",
  " ",
  "K",
  "／",
  "é",
  "é",
);

function spell(segment: string, ops: readonly string[]): string {
  let out = "";
  let at = 0;
  for (const ch of segment) {
    const op = ops[at % ops.length] ?? "keep";
    at += 1;
    const hex = ch.charCodeAt(0).toString(16).padStart(2, "0");
    if (op === "upper") out += ch.toUpperCase();
    else if (op === "pct") out += `%${hex.toUpperCase()}`;
    else if (op === "pctLower") out += `%${hex}`;
    else out += ch;
  }
  return out;
}

const spelling = fc
  .record({
    base: fc.constantFrom(...BASES),
    ops: fc.array(charOp, { minLength: 8, maxLength: 8 }),
    seps: fc.array(separator, { minLength: 3, maxLength: 3 }),
    lead,
    tail,
  })
  .map(({ base, ops, seps, lead: start, tail: end }) => {
    let out = start;
    base.forEach((segment, index) => {
      out += spell(segment, ops);
      if (index < base.length - 1) out += seps[index] ?? "/";
    });
    return `${out}${end}`;
  });

/** A parsed URL for a spelling, or undefined when the URL parser refuses it. */
function parse(path: string): URL | undefined {
  try {
    return new URL(`${ORIGIN}${path}`);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

describe("SEC2-CLERK-5x the route matcher agrees with the router", () => {
  const router = createMatcher(TREE);
  const strictRouter = createMatcher(TREE, { caseSensitive: true });

  it("[SEC2-CLERK-50] fuzz: no spelling reaches a protected page without being matched (case-insensitive router)", () => {
    const isProtected = createRouteMatcher(PROTECT);
    let served = 0;
    fc.assert(
      fc.property(spelling, (path) => {
        const url = parse(path);
        fc.pre(url !== undefined);
        if (url === undefined) return;
        const page = servedBy(router, url);
        if (page === undefined || !page.startsWith("P:")) return;
        served += 1;
        expect(isProtected(new Request(url)), `${path} serves ${page}`).toBe(true);
        expect(isProtected(url)).toBe(true);
      }),
      PROPS,
    );
    // Not vacuous: a healthy share of the generated spellings does reach a protected page.
    expect(served).toBeGreaterThan(PROPS.numRuns / 20);
  });

  it("[SEC2-CLERK-51] fuzz: with a case-sensitive router the matcher built with caseSensitive covers the same pages", () => {
    const isProtected = createRouteMatcher(PROTECT, { caseSensitive: true });
    fc.assert(
      fc.property(spelling, (path) => {
        const url = parse(path);
        fc.pre(url !== undefined);
        if (url === undefined) return;
        const page = servedBy(strictRouter, url);
        if (page === undefined || !page.startsWith("P:")) return;
        expect(isProtected(new Request(url)), `${path} serves ${page}`).toBe(true);
      }),
      PROPS,
    );
  });

  it("[SEC2-CLERK-52] fuzz: an allow-list pattern matches only spellings the router serves as that page", () => {
    // The other direction matters for a public list: a spelling the matcher calls public must really be the
    // public page, not another page that happens to match a wildcard route.
    const isPublic = createRouteMatcher(PUBLIC);
    let matched = 0;
    fc.assert(
      fc.property(spelling, (path) => {
        const url = parse(path);
        fc.pre(url !== undefined);
        if (url === undefined) return;
        if (!isPublic(new Request(url))) return;
        matched += 1;
        const page = servedBy(router, url);
        expect(["public:about", "public:tasks-id"], `${path} is served by ${page}`).toContain(page);
      }),
      PROPS,
    );
    expect(matched).toBeGreaterThan(PROPS.numRuns / 40);
  });

  it.each([
    ["encoded dot segments resolve before matching", "/public/%2e%2e/dashboard", true],
    [
      "a double-encoded dot segment is plain text, so the path is not the dashboard",
      "/%252e%252e/dashboard",
      false,
    ],
    ["a backslash is a slash", "/dashboard\\settings", true],
    [
      "an encoded backslash stays inside one segment and still starts with the section",
      "/dashboard%5Csecret",
      true,
    ],
    ["an encoded slash stays inside one segment", "/dashboard%2Fsecret", true],
    ["a path parameter is part of the segment", "/dashboard;jsessionid=1", true],
    ["a trailing slash", "/dashboard/", true],
    ["upper case", "/DASHBOARD/Settings", true],
    ["a percent-encoded letter in either hex case", "/%64%41shboard", true],
    ["a null byte in the middle starts another segment name", "/dash%00board", false],
    ["the public page is not protected", "/about", false],
    ["the root is not protected", "/", false],
  ] as const)("[SEC2-CLERK-53] %s: %s", (_name, path, expected) => {
    const isProtected = createRouteMatcher(PROTECT);
    expect(isProtected(new Request(`${ORIGIN}${path}`))).toBe(expected);
  });

  it("[SEC2-CLERK-54] a path with a double slash is not served by the router, so the matcher need not cover it", () => {
    expect(servedBy(router, new URL(`${ORIGIN}//dashboard`))).toBeUndefined();
    expect(servedBy(router, new URL(`${ORIGIN}/dashboard//settings`))).toBeUndefined();
  });

  it("[SEC2-CLERK-55] a string that starts with two slashes is a path, never a host", () => {
    // `new URL("//dashboard", base)` reads "dashboard" as a host; the matcher takes the string as written.
    const isProtected = createRouteMatcher(["/evil.example/x"]);
    expect(isProtected("//evil.example/x")).toBe(false);
    expect(isProtected("/evil.example/x")).toBe(true);
    const all = createRouteMatcher(["/(.*)"]);
    expect(all("//anything")).toBe(true);
  });

  it("[SEC2-CLERK-56] matching is ASCII case-insensitive like the router: the Kelvin sign is not a k", () => {
    // `"K".toLowerCase()` is "k", so a Unicode-aware lower-casing would call this path the `/kids` page.
    // The router compares ASCII only and does not serve it as `/kids`: an allow-list entry must not either.
    const isPublic = createRouteMatcher(["/kids"]);
    expect(isPublic("/kids")).toBe(true);
    expect(isPublic("/KIDS")).toBe(true);
    expect(isPublic("/Kids")).toBe(false);
    const dotted = createRouteMatcher(["/admin"]);
    expect(dotted("/ADMİN")).toBe(false);
  });

  it("[SEC2-CLERK-57] a pattern with a trailing slash covers the same page as the one without", () => {
    // The router serves /admin and /admin/ as one page. A pattern written "/admin/" must therefore match both,
    // or a rule that looks like it protects the page protects nothing.
    const isProtected = createRouteMatcher(["/admin/", "/billing/:id/"]);
    expect(isProtected("/admin")).toBe(true);
    expect(isProtected("/admin/")).toBe(true);
    expect(isProtected("/billing/42")).toBe(true);
    expect(isProtected("/billing/42/")).toBe(true);
    expect(isProtected("/admin/x")).toBe(false);
  });

  it("[SEC2-CLERK-58] a pattern is compared with the router's canonical spelling, so an escaped pattern matches", () => {
    const isProtected = createRouteMatcher(["/files/a%41", "/caf%C3%A9"]);
    // The router serves "/files/aA" and "/files/a%41" as the same page, and so does "/CAF%c3%a9" for the café page.
    expect(isProtected("/files/aA")).toBe(true);
    expect(isProtected("/files/a%41")).toBe(true);
    expect(isProtected("/CAF%c3%a9")).toBe(true);
    expect(isProtected("/café")).toBe(true);
    // NFD is a different spelling for the router (it does not normalize), so it is a different page.
    expect(isProtected("/café")).toBe(false);
  });

  it("[SEC2-CLERK-59] empty and degenerate patterns are refused at creation, and the root pattern matches only the root", () => {
    expect(() => createRouteMatcher([""])).toThrow(TypeError);
    expect(() => createRouteMatcher(["(.*)"])).toThrow(TypeError);
    expect(() => createRouteMatcher(["*"])).toThrow(TypeError);
    expect(() => createRouteMatcher(["/a b"])).toThrow(TypeError);
    expect(() => createRouteMatcher(["/\u0000"])).toThrow(TypeError);
    expect(() => createRouteMatcher(["/／"])).toThrow(TypeError);
    const root = createRouteMatcher(["/"]);
    expect(root("/")).toBe(true);
    expect(root("/x")).toBe(false);
  });

  it("[SEC2-CLERK-59a] a malformed escape is matched on the raw spelling and never throws", () => {
    const isProtected = createRouteMatcher(["/dashboard(.*)"]);
    expect(isProtected("/dashboard/%zz")).toBe(true);
    expect(isProtected("/%64ashboard/%zz")).toBe(true);
    expect(isProtected("/%E0%A4%A")).toBe(false);
  });
});
