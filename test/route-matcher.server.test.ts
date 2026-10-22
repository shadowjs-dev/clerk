import { describe, expect, it } from "vitest";
import { createRouteMatcher } from "../src/server/route-matcher";

describe("createRouteMatcher", () => {
  it("[RM-1] a pattern with (.*) is a prefix match: the section, everything below it, and any path it starts", () => {
    const isProtected = createRouteMatcher(["/dashboard(.*)"]);
    expect(isProtected("/dashboard")).toBe(true);
    expect(isProtected("/dashboard/settings/billing")).toBe(true);
    // Like Clerk's matcher, (.*) also matches the rest of a longer segment: a route guard fails safe.
    expect(isProtected("/dashboards")).toBe(true);
    expect(isProtected("/")).toBe(false);
    expect(isProtected("/blog/dashboard")).toBe(false);
  });

  it("[RM-2] a plain path matches exactly, without its children", () => {
    const isPublic = createRouteMatcher(["/", "/about"]);
    expect(isPublic("/")).toBe(true);
    expect(isPublic("/about")).toBe(true);
    expect(isPublic("/about/team")).toBe(false);
  });

  it("[RM-3] :param matches one path segment, and * matches anything", () => {
    const tasks = createRouteMatcher(["/tasks/:id/edit"]);
    expect(tasks("/tasks/42/edit")).toBe(true);
    expect(tasks("/tasks/42/extra/edit")).toBe(false);
    const any = createRouteMatcher(["/api/*"]);
    expect(any("/api/a/b/c")).toBe(true);
  });

  it("[RM-4] a Request or a URL is matched by its pathname, query string ignored", () => {
    const isProtected = createRouteMatcher(["/dashboard(.*)"]);
    expect(isProtected(new Request("https://app.example.com/dashboard?tab=1"))).toBe(true);
    expect(isProtected(new URL("https://app.example.com/sign-in?next=/dashboard"))).toBe(false);
  });

  it("[RM-5] several patterns: a path matches when any of them does", () => {
    const isProtected = createRouteMatcher(["/dashboard(.*)", "/admin(.*)"]);
    expect(isProtected("/admin/users")).toBe(true);
    expect(isProtected("/blog")).toBe(false);
  });

  it("[RM-6] a pattern the matcher cannot express is rejected when the matcher is created", () => {
    expect(() => createRouteMatcher(["/a/[id]"])).toThrow(TypeError);
    expect(() => createRouteMatcher(["dashboard"])).toThrow(TypeError);
    expect(() => createRouteMatcher([])).toThrow(TypeError);
  });

  it("[RM-7] patterns are literal text: a dot or a plus in the path does not match a wildcard", () => {
    const isStatic = createRouteMatcher(["/files/a.txt"]);
    expect(isStatic("/files/a.txt")).toBe(true);
    expect(isStatic("/files/aXtxt")).toBe(false);
  });
});
