import { describe, expect, it } from "vitest";
import type {
  ClerkConstructor,
  ClerkLike,
  ClerkProviderProps,
  ClerkSignInFuture,
  ClerkSignUpFuture,
} from "../src/index";
import type { FakeClerk } from "./support/fake-clerk";

/**
 * Compile-time checks: the real Clerk SDK types must be assignable to the structural types this
 * package depends on. `tsc -p packages/clerk/tsconfig.json` fails when one of these stops holding.
 * The runtime assertions only keep the file honest; the checks are the assignments below.
 */
type RealClerk = import("@clerk/clerk-js").Clerk;
type RealClerkConstructor = typeof import("@clerk/clerk-js").Clerk;

const realInstanceIsClerkLike = (clerk: RealClerk): ClerkLike => clerk;
const realConstructorIsClerkConstructor = (ctor: RealClerkConstructor): ClerkConstructor => ctor;
const realInstanceCanBeInjected = (clerk: RealClerk): ClerkProviderProps => ({
  publishableKey: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
  clerk,
});
const fakeIsClerkLike = (fake: FakeClerk): ClerkLike => fake;
/**
 * clerk-js's own future resources (the values of its `signInSignal` and `signUpSignal`) must stay assignable to the
 * structural types this package hands out: the custom flow guide and the hooks rely on them.
 */
type RealState = RealClerk["__internal_state"];
type RealSignIn = NonNullable<ReturnType<RealState["signInSignal"]>["signIn"]>;
type RealSignUp = NonNullable<ReturnType<RealState["signUpSignal"]>["signUp"]>;
const realSignInIsFuture = (resource: RealSignIn): ClerkSignInFuture => resource;
const realSignUpIsFuture = (resource: RealSignUp): ClerkSignUpFuture => resource;

describe("type compatibility with @clerk/clerk-js", () => {
  it("[TYP-01] the real Clerk instance is assignable to ClerkLike", () => {
    expect(typeof realInstanceIsClerkLike).toBe("function");
  });

  it("[TYP-02] the real Clerk constructor is assignable to ClerkConstructor", () => {
    expect(typeof realConstructorIsClerkConstructor).toBe("function");
  });

  it("[TYP-03] the real Clerk instance can be injected through ClerkProviderProps.clerk", () => {
    expect(typeof realInstanceCanBeInjected).toBe("function");
  });

  it("[TYP-04] the test double is assignable to ClerkLike", () => {
    expect(typeof fakeIsClerkLike).toBe("function");
  });

  it("[TYP-05] clerk-js's future sign-in resource is assignable to ClerkSignInFuture", () => {
    expect(typeof realSignInIsFuture).toBe("function");
  });

  it("[TYP-06] clerk-js's future sign-up resource is assignable to ClerkSignUpFuture", () => {
    expect(typeof realSignUpIsFuture).toBe("function");
  });
});
