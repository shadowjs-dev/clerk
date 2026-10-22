import { describe, expect, it } from "vitest";
import { attempt, readOptions } from "../src/internal/actions";
import { membershipAllows } from "../src/internal/context";
import { checkPublishableKey } from "../src/internal/keys";

describe("checkPublishableKey", () => {
  it.each([
    "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
    "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k",
    "pk_test_a+b/c=d_e-f",
  ])("[INT-01] accepts %s", (key) => {
    expect(checkPublishableKey(key)).toBe(key);
  });

  it.each([
    undefined,
    null,
    42,
    "",
    "pk_test_",
    "pk_other_MARKER",
    "sk_test_MARKER",
    "pk_test_MARKER has space",
  ])("[INT-02] rejects %s with a TypeError that never echoes the marker value", (key) => {
    expect(() => checkPublishableKey(key)).toThrow(TypeError);
    const error = captureError(() => checkPublishableKey(key));
    expect(String(error)).not.toContain("MARKER");
  });
});

/** Returns what `fn` threw; fails the test when nothing was thrown. */
function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("membershipAllows", () => {
  const membership = {
    role: "org:admin",
    permissions: ["org:billing:read"],
    organization: { id: "org_1" },
  };

  it("[INT-03] an empty check is never an authorization", () => {
    expect(membershipAllows(membership, {})).toBe(false);
  });

  it("[INT-04] no membership means no authorization, whatever the check", () => {
    expect(membershipAllows(null, { role: "org:admin" })).toBe(false);
    expect(membershipAllows(null, { permission: "org:billing:read" })).toBe(false);
  });

  it("[INT-05] matches the role exactly", () => {
    expect(membershipAllows(membership, { role: "org:admin" })).toBe(true);
    expect(membershipAllows(membership, { role: "org:member" })).toBe(false);
    expect(membershipAllows(membership, { role: "admin" })).toBe(false);
  });

  it("[INT-06] matches the permission in the membership's list", () => {
    expect(membershipAllows(membership, { permission: "org:billing:read" })).toBe(true);
    expect(membershipAllows(membership, { permission: "org:billing:write" })).toBe(false);
  });

  it("[INT-07] a membership without a permission list has no permissions", () => {
    const bare = { role: "org:member", organization: { id: "org_1" } };
    expect(membershipAllows(bare, { permission: "org:billing:read" })).toBe(false);
  });

  it("[INT-08] role and permission are both required when both are given", () => {
    expect(
      membershipAllows(membership, { role: "org:admin", permission: "org:billing:read" }),
    ).toBe(true);
    expect(
      membershipAllows(membership, { role: "org:member", permission: "org:billing:read" }),
    ).toBe(false);
    expect(
      membershipAllows(membership, { role: "org:admin", permission: "org:billing:write" }),
    ).toBe(false);
  });

  it("[INT-09] an explicit undefined role is treated as absent", () => {
    expect(membershipAllows(membership, { role: undefined, permission: "org:billing:read" })).toBe(
      true,
    );
  });
});

describe("attempt", () => {
  it("[INT-10] a synchronous return is not an error", () => {
    const failures: unknown[] = [];
    attempt(
      () => 1,
      (error) => failures.push(error),
    );
    expect(failures).toEqual([]);
  });

  it("[INT-11] a synchronous throw goes to the failure handler", () => {
    const failures: unknown[] = [];
    const boom = new Error("sync");
    attempt(
      () => {
        throw boom;
      },
      (error) => failures.push(error),
    );
    expect(failures).toEqual([boom]);
  });

  it("[INT-12] a rejected promise goes to the failure handler", async () => {
    const failures: unknown[] = [];
    const boom = new Error("async");
    attempt(
      () => Promise.reject(boom),
      (error) => failures.push(error),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failures).toEqual([boom]);
  });

  it("[INT-13] a resolved promise is not an error", async () => {
    const failures: unknown[] = [];
    attempt(
      () => Promise.resolve("ok"),
      (error) => failures.push(error),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failures).toEqual([]);
  });

  it("[INT-14] a thenable that is not a promise is handled like one", async () => {
    const failures: unknown[] = [];
    const boom = new Error("thenable");
    const thenable = {
      // biome-ignore lint/suspicious/noThenProperty: the point of the test is a thenable that is not a promise
      then(_resolve: unknown, reject: (reason: unknown) => void) {
        reject(boom);
      },
    };
    attempt(
      () => thenable,
      (error) => failures.push(error),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failures).toEqual([boom]);
  });
});

describe("readOptions", () => {
  it("[INT-15] copies every key except children", () => {
    const props = { path: "/x", children: "ignored", routing: "path" };
    expect(readOptions(props, [])).toEqual({ path: "/x", routing: "path" });
  });

  it("[INT-16] omits the named keys", () => {
    const props = { mode: "redirect", signInUrl: "/in" };
    expect(readOptions(props, ["mode"])).toEqual({ signInUrl: "/in" });
  });

  it("[INT-17] reads getters, so a reactive prop reports its current value", () => {
    let current = "a";
    const props = {
      get path() {
        return current;
      },
    };
    current = "b";
    expect(readOptions(props, [])).toEqual({ path: "b" });
  });

  it("[INT-18] ignores prototype properties", () => {
    const base = { inherited: true };
    const props = Object.create(base) as Record<string, unknown>;
    props["own"] = 1;
    expect(Object.keys(readOptions(props, []))).toEqual(["own"]);
  });
});
