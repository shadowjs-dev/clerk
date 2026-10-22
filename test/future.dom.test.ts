import { useEffect } from "@shadow-js/core";
import { cleanup, flush } from "@shadow-js/testing/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClerkFlowErrors, ClerkSignInFuture } from "../src/index";
import { useSignIn, useSignUp } from "../src/index";
import { createFlowMirror } from "../src/internal/flow-mirror";
import { mountProvider } from "./support/app";
import { FakeClerk, type FakeSignInFuture } from "./support/fake-clerk";

afterEach(() => cleanup());

/** The sign-in resource the fake currently holds, asserted to exist. */
function currentSignIn(clerk: FakeClerk): FakeSignInFuture {
  const resource = clerk.futureSignIn();
  if (resource === null) throw new Error("the fake has no sign-in resource");
  return resource;
}

const NO_ERRORS: ClerkFlowErrors = { fields: {}, raw: null, global: null };

describe("clerk-js's future sign-in state (useSignIn)", () => {
  it("[FUT-01] after load, signIn() is clerk-js's future resource, with reset and sso", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSignIn(), { clerk });
    await flush();
    const sign = value.signIn();
    expect(sign).not.toBeNull();
    expect(sign).toBe(clerk.futureSignIn());
    expect(typeof sign?.reset).toBe("function");
    expect(typeof sign?.sso).toBe("function");
  });

  it("[FUT-02] one subscription per loaded instance: subscribed once, disposed once at unmount", async () => {
    const clerk = new FakeClerk();
    mountProvider(() => useSignIn(), { clerk });
    await flush();
    expect(clerk.count("__internal_effect")).toBe(1);
    // A later Clerk event reads the mirrored state; it does not subscribe again.
    clerk.set({ session: null });
    await flush();
    expect(clerk.count("__internal_effect")).toBe(1);
    expect(clerk.count("effect.dispose")).toBe(0);
    cleanup();
    expect(clerk.count("effect.dispose")).toBe(1);
    // After unmount a change in clerk-js reaches nobody: no further write, no error.
    currentSignIn(clerk).setStatus("needs_first_factor");
    await flush();
    expect(clerk.count("effect.dispose")).toBe(1);
  });

  it("[FUT-03] reset() flips the status, notifies, and the accessor and its readers see the change", async () => {
    const clerk = new FakeClerk();
    const seen: (string | null)[] = [];
    const { value } = mountProvider(
      () => {
        const signIn = useSignIn();
        useEffect(() => {
          seen.push(signIn.signIn()?.status ?? null);
        });
        return signIn;
      },
      { clerk },
    );
    await flush();
    currentSignIn(clerk).setStatus("needs_first_factor");
    await flush();
    expect(seen.at(-1)).toBe("needs_first_factor");
    const result = await value.signIn()?.reset();
    await flush();
    expect(result).toEqual({ error: null });
    expect(seen.at(-1)).toBe("needs_identifier");
    expect(clerk.callsTo("signIn.reset")).toHaveLength(1);
  });

  it("[FUT-04] sso() records its arguments and resolves { error: null } (no redirect in the fake)", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSignIn(), { clerk });
    await flush();
    const params = {
      strategy: "oauth_google",
      redirectUrl: "/",
      redirectCallbackUrl: "/sign-in/sso-callback",
    };
    const result = await value.signIn()?.sso(params);
    expect(result).toEqual({ error: null });
    expect(clerk.callsTo("signIn.sso").map((call) => call.args)).toEqual([[params]]);
  });

  it("[FUT-05] the errors and fetch status of a request reach the accessors", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSignIn(), { clerk });
    await flush();
    expect(value.errors()).toEqual(NO_ERRORS);
    expect(value.fetchStatus()).toBe("idle");
    const failing: ClerkFlowErrors = {
      fields: { password: { message: "Password is incorrect.", code: "form_password_incorrect" } },
      raw: [{ code: "form_password_incorrect" }],
      global: null,
    };
    clerk.setSignInFetch(failing, "fetching");
    await flush();
    expect(value.fetchStatus()).toBe("fetching");
    expect(value.errors().fields["password"]?.message).toBe("Password is incorrect.");
    clerk.setSignInFetch(failing, "idle");
    await flush();
    expect(value.fetchStatus()).toBe("idle");
  });

  it("[FUT-06] a failed call reports its error and sets the errors accessor", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSignIn(), { clerk });
    await flush();
    currentSignIn(clerk).passwordFailure = { message: "Password is incorrect." };
    const result = await value
      .signIn()
      ?.password({ password: "wrong", identifier: "a@example.com" });
    await flush();
    expect(result?.error?.message).toBe("Password is incorrect.");
    expect(value.errors().fields["password"]?.message).toBe("Password is incorrect.");
  });

  it("[FUT-07] without clerk-js's state: signIn() is null, the errors are empty, and one error names the version", async () => {
    const clerk = new FakeClerk().withoutInternalState();
    const { value } = mountProvider(() => useSignIn(), { clerk });
    await flush();
    expect(value.isLoaded()).toBe(true);
    expect(value.signIn()).toBeNull();
    expect(value.errors()).toEqual(NO_ERRORS);
    expect(value.fetchStatus()).toBe("idle");
    // A later Clerk event reports nothing more: the message is written once per provider.
    clerk.set({ user: null });
    await flush();
    const reports = vi.mocked(console.error).mock.calls.map((call) => String(call[0]));
    vi.mocked(console.error).mockClear();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("6.38.1");
    expect(reports[0]).not.toContain("__internal_state");
  });

  it("[FUT-08] a resource without the future methods is never handed out as the future (legacy attempts have no reset())", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSignIn(), { clerk });
    await flush();
    // The shape of clerk's legacy `client.signIn` resource: status only, no reset() and no sso().
    clerk.setFutureSignIn({ status: "needs_first_factor" } as unknown as FakeSignInFuture);
    await flush();
    expect(value.signIn()).toBeNull();
    const reports = vi.mocked(console.error).mock.calls.map((call) => String(call[0]));
    vi.mocked(console.error).mockClear();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain("without the future methods");
  });

  it("[FUT-09] the mirror follows one instance at a time: switching disposes the old subscription exactly once", async () => {
    const first = new FakeClerk();
    const second = new FakeClerk();
    await first.load();
    await second.load();
    const mirrored: unknown[] = [];
    const mirror = createFlowMirror((flows) => mirrored.push(flows.signIn.resource));
    mirror.follow(first);
    mirror.follow(first);
    expect(first.count("__internal_effect")).toBe(1);
    mirror.follow(second);
    expect(first.count("effect.dispose")).toBe(1);
    expect(second.count("__internal_effect")).toBe(1);
    mirror.follow(null);
    expect(second.count("effect.dispose")).toBe(1);
    expect(first.count("effect.dispose")).toBe(1);
    // The last value written is the second instance's resource: a disposed instance writes nothing further.
    expect(mirrored.at(-1)).toBe(second.futureSignIn());
  });

  it("[FUT-10] a change of one resource reaches the mirror once, and useSignUp mirrors the future sign-up the same way", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => ({ signIn: useSignIn(), signUp: useSignUp() }), {
      clerk,
    });
    await flush();
    const signUp = clerk.__internal_state?.signUpResource.get() ?? null;
    expect(value.signUp.signUp()).toBe(signUp);
    expect(typeof value.signUp.signUp()?.reset).toBe("function");
    const result = await value.signUp.signUp()?.reset();
    expect(result).toEqual({ error: null });
    expect(clerk.callsTo("signUp.reset")).toHaveLength(1);
    // The sign-in accessor is untouched by a sign-up change.
    expect(value.signIn.signIn()).toBe(clerk.futureSignIn());
  });
});

describe("the future sign-in type", () => {
  it("[FUT-11] the fake sign-in resource carries the members the custom flow guide uses", async () => {
    const clerk = new FakeClerk();
    await clerk.load();
    const resource = currentSignIn(clerk);
    const asFuture = resource as unknown as ClerkSignInFuture;
    expect(asFuture.status).toBe("needs_identifier");
    expect(typeof asFuture.emailCode.sendCode).toBe("function");
  });
});
