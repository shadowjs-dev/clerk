import { cleanup, flush } from "@shadow-js/testing/dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  useAuth,
  useClerk,
  useOrganization,
  useSession,
  useSignIn,
  useSignUp,
  useUser,
} from "../src/index";
import { mountProvider } from "./support/app";
import { FakeClerk, FakeSession, fakeMembership, fakeOrg, fakeUser } from "./support/fake-clerk";

afterEach(() => cleanup());

/** A provider with a signed-in user, returning the auth hook result and the fake. */
async function signedIn(options: { token?: string | null } = {}) {
  const clerk = new FakeClerk();
  const session = new FakeSession("sess_1");
  if (options.token !== undefined) session.token = options.token;
  const { value } = mountProvider(() => useAuth(), { clerk });
  await flush();
  clerk.set({
    user: fakeUser("user_1", [fakeMembership("org_1", "org:admin", ["org:billing:read"])]),
    session,
    organization: fakeOrg("org_1"),
  });
  return { clerk, session, auth: value };
}

describe("useAuth: state fields", () => {
  it("[AUT-01] every state field is an accessor", () => {
    const { value } = mountProvider(() => useAuth(), { clerk: new FakeClerk() });
    for (const field of [
      value.isLoaded,
      value.isSignedIn,
      value.userId,
      value.sessionId,
      value.orgId,
      value.orgRole,
    ]) {
      expect(typeof field).toBe("function");
    }
    expect(typeof value.getToken).toBe("function");
    expect(typeof value.signOut).toBe("function");
  });

  it("[AUT-02] all ids and the role are null when signed out", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useAuth(), { clerk });
    await flush();
    clerk.set({ user: null, session: null, organization: null });
    expect(value.userId()).toBeNull();
    expect(value.sessionId()).toBeNull();
    expect(value.orgId()).toBeNull();
    expect(value.orgRole()).toBeNull();
  });

  it("[AUT-03] while signed in every field carries the active values", async () => {
    const { auth } = await signedIn();
    expect(auth.isLoaded()).toBe(true);
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.userId()).toBe("user_1");
    expect(auth.sessionId()).toBe("sess_1");
    expect(auth.orgId()).toBe("org_1");
    expect(auth.orgRole()).toBe("org:admin");
  });

  it("[AUT-04] repeated reads of a derived field return the same value", async () => {
    const { auth } = await signedIn();
    const first = auth.userId();
    expect(auth.userId()).toBe(first);
  });
});

describe("useAuth: getToken", () => {
  it("[AUT-05] returns the session token of the active session", async () => {
    const { auth } = await signedIn({ token: "tok-abc" });
    expect(await auth.getToken()).toBe("tok-abc");
  });

  it("[AUT-06] forwards template and skipCache to the session", async () => {
    const { auth, session } = await signedIn();
    await auth.getToken({ template: "convex", skipCache: true });
    expect(session.tokenCalls).toEqual([{ template: "convex", skipCache: true }]);
  });

  it("[AUT-07] calls the session without options when none are given", async () => {
    const { auth, session } = await signedIn();
    await auth.getToken();
    expect(session.tokenCalls).toEqual([undefined]);
  });

  it("[AUT-08] resolves null when there is no session", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useAuth(), { clerk });
    await flush();
    expect(await value.getToken()).toBeNull();
  });

  it("[AUT-09] resolves null for a pending session", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useAuth(), { clerk });
    await flush();
    clerk.set({ session: new FakeSession("sess_p", "pending") });
    expect(await value.getToken()).toBeNull();
  });

  it("[AUT-10] resolves null after sign-out, without calling the old session", async () => {
    const { auth, session, clerk } = await signedIn({ token: "tok" });
    await clerk.signOut();
    expect(await auth.getToken({ template: "convex" })).toBeNull();
    expect(session.tokenCalls).toEqual([]);
  });

  it("[AUT-11] resolves null when the session changed while the token was in flight", async () => {
    const { auth, session, clerk } = await signedIn({ token: "tok-old" });
    let release: () => void = () => undefined;
    session.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = auth.getToken();
    clerk.set({ session: new FakeSession("sess_2") });
    release();
    expect(await pending).toBeNull();
  });

  it("[AUT-12] resolves the token when the session object was replaced by the same session", async () => {
    const { auth, session, clerk } = await signedIn({ token: "tok-same" });
    let release: () => void = () => undefined;
    session.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = auth.getToken();
    clerk.set({ session: session });
    release();
    expect(await pending).toBe("tok-same");
  });

  it("[AUT-13] resolves null when the session has no token", async () => {
    const { auth } = await signedIn({ token: null });
    expect(await auth.getToken()).toBeNull();
  });

  it("[AUT-14] a rejected session.getToken rejects the returned promise with the same error", async () => {
    const { auth, session } = await signedIn();
    const failure = new Error("network failed");
    session.failure = { error: failure };
    await expect(auth.getToken()).rejects.toBe(failure);
  });

  it("[AUT-15] a session cleared by an event resolves null without asking the old session", async () => {
    const { auth, session, clerk } = await signedIn({ token: "tok-disposed" });
    clerk.set({ session: null });
    expect(await auth.getToken()).toBeNull();
    expect(session.tokenCalls.length).toBe(0);
  });
});

describe("useAuth: signOut", () => {
  it("[AUT-16] delegates to clerk.signOut with the given options", async () => {
    const { auth, clerk } = await signedIn();
    await auth.signOut({ redirectUrl: "/bye" });
    expect(clerk.callsTo("signOut")).toEqual([
      { method: "signOut", args: [{ redirectUrl: "/bye" }] },
    ]);
  });

  it("[AUT-17] after signOut resolves the state is signed out", async () => {
    const { auth } = await signedIn();
    await auth.signOut();
    expect(auth.isSignedIn()).toBe(false);
    expect(auth.userId()).toBeNull();
  });

  it("[AUT-18] signOut before Clerk has loaded resolves without calling the instance", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useAuth(), { clerk });
    await expect(value.signOut()).resolves.toBeUndefined();
    expect(clerk.count("signOut")).toBe(0);
  });

  it("[AUT-19] a failing signOut rejects the returned promise", async () => {
    const { auth, clerk } = await signedIn();
    clerk.signOutFailure = { error: new Error("sign-out failed") };
    await expect(auth.signOut()).rejects.toThrow("sign-out failed");
  });
});

describe("useUser, useSession, useOrganization", () => {
  it("[AUT-20] useUser returns the user, signed-in flag and loaded flag", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useUser(), { clerk });
    await flush();
    const user = fakeUser("user_9");
    clerk.set({ user, session: new FakeSession("sess_9") });
    expect(value.isLoaded()).toBe(true);
    expect(value.isSignedIn()).toBe(true);
    expect(value.user()).toBe(user);
  });

  it("[AUT-21] useSession returns the session accessor and loaded flag", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSession(), { clerk });
    expect(value.isLoaded()).toBe(false);
    await flush();
    // Loaded with no visitor: the session is known to be null, so the state is loaded and signed out.
    expect(value.isLoaded()).toBe(true);
    expect(value.session()).toBe(null);
    const session = new FakeSession("sess_s");
    clerk.set({ session });
    expect(value.isLoaded()).toBe(true);
    expect(value.session()).toBe(session);
    expect(value.isSignedIn()).toBe(true);
  });

  it("[AUT-22] useOrganization returns the organization and the membership", async () => {
    const clerk = new FakeClerk();
    const org = fakeOrg("org_z");
    const membership = fakeMembership("org_z", "org:member");
    const { value } = mountProvider(() => useOrganization(), { clerk });
    await flush();
    clerk.set({
      user: fakeUser("user_z", [membership]),
      session: new FakeSession("sess_z"),
      organization: org,
    });
    expect(value.organization()).toBe(org);
    expect(value.membership()).toEqual(membership);
    expect(value.isLoaded()).toBe(true);
  });

  it("[AUT-23] useOrganization is not loaded while the organization is undefined", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useOrganization(), { clerk });
    await flush();
    clerk.set({ organization: undefined });
    expect(value.isLoaded()).toBe(false);
  });
});

describe("useSignIn and useSignUp", () => {
  it("[AUT-24] useSignIn exposes the attempt and setActive once loaded", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSignIn(), { clerk });
    await flush();
    expect(value.isLoaded()).toBe(true);
    await value.setActive({ session: "sess_next" });
    expect(clerk.callsTo("setActive")).toEqual([
      { method: "setActive", args: [{ session: "sess_next" }] },
    ]);
  });

  it("[AUT-25] useSignIn.setActive before load rejects with a clear error", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSignIn(), { clerk });
    await expect(value.setActive({ session: "x" })).rejects.toThrow("before Clerk has loaded");
  });

  it("[AUT-26] useSignUp exposes clerk-js's future sign-up resource", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSignUp(), { clerk });
    await flush();
    const resource = clerk.__internal_state?.signUpResource.get();
    expect(resource).not.toBeNull();
    expect(value.signUp()).toBe(resource);
    expect(value.isLoaded()).toBe(true);
  });

  it("[AUT-27] useSignUp.setActive resolves through the instance", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSignUp(), { clerk });
    await flush();
    await value.setActive({ organization: "org_new" });
    expect(clerk.callsTo("setActive")).toEqual([
      { method: "setActive", args: [{ organization: "org_new" }] },
    ]);
  });

  it("[AUT-28] the sign-in is null when clerk-js holds no sign-in resource", async () => {
    const clerk = new FakeClerk();
    const { value } = mountProvider(() => useSignIn(), { clerk });
    await flush();
    clerk.setFutureSignIn(null);
    expect(value.signIn()).toBeNull();
  });
});

describe("hooks outside a provider", () => {
  it.each([
    ["useAuth", useAuth],
    ["useUser", useUser],
    ["useSession", useSession],
    ["useOrganization", useOrganization],
    ["useSignIn", useSignIn],
    ["useSignUp", useSignUp],
    ["useClerk", useClerk],
  ])("[AUT-29] %s throws an error that names the hook", (name, hook) => {
    let thrown: unknown;
    try {
      hook();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String((thrown as Error).message)).toContain(
      `${name} must be used inside <ClerkProvider>.`,
    );
  });
});
