import { useEffect } from "@shadow-js/core";
import { cleanup, flush } from "@shadow-js/testing/dom";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { useAuth, useOrganization, useSignIn, useUser } from "../src/index";
import { mountProvider } from "./support/app";
import { FakeClerk, FakeSession, fakeMembership, fakeOrg, fakeUser } from "./support/fake-clerk";

afterEach(() => cleanup());

/** Mounts a provider and returns the hook results, plus the fake and a flush helper. */
function setup(clerk = new FakeClerk()) {
  const box = mountProvider(
    () => ({ auth: useAuth(), user: useUser(), org: useOrganization(), signIn: useSignIn() }),
    { clerk },
  );
  return { clerk, ...box.value, view: box.view };
}

describe("state mirroring: sign-in and sign-out transitions", () => {
  it("[STA-01] a sign-in event makes the user, session and active id readable", async () => {
    const { clerk, auth } = setup();
    await flush();
    clerk.set({ user: fakeUser("user_1"), session: new FakeSession("sess_1") });
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.userId()).toBe("user_1");
    expect(auth.sessionId()).toBe("sess_1");
  });

  it("[STA-02] a sign-out event clears user, session and organization", async () => {
    const { clerk, auth } = setup();
    await flush();
    clerk.set({
      user: fakeUser("user_1"),
      session: new FakeSession("sess_1"),
      organization: fakeOrg("org_1"),
    });
    clerk.set({ user: null, session: null, organization: null });
    expect(auth.isSignedIn()).toBe(false);
    expect(auth.userId()).toBeNull();
    expect(auth.sessionId()).toBeNull();
    expect(auth.orgId()).toBeNull();
  });

  it("[STA-03] signOut() on the instance drives the same transition", async () => {
    const { clerk, auth } = setup();
    await flush();
    clerk.set({ user: fakeUser("user_1"), session: new FakeSession("sess_1") });
    await clerk.signOut();
    expect(auth.isSignedIn()).toBe(false);
    expect(clerk.count("signOut")).toBe(1);
  });

  it("[STA-04] repeated sign-in and sign-out cycles end in the state of the last event", async () => {
    const { clerk, auth } = setup();
    await flush();
    for (let turn = 0; turn < 5; turn += 1) {
      clerk.set({ user: fakeUser(`user_${turn}`), session: new FakeSession(`sess_${turn}`) });
      clerk.set({ user: null, session: null });
    }
    expect(auth.isSignedIn()).toBe(false);
    clerk.set({ user: fakeUser("user_final"), session: new FakeSession("sess_final") });
    expect(auth.userId()).toBe("user_final");
    expect(auth.sessionId()).toBe("sess_final");
  });

  it("[STA-05] a pending session is not a signed-in session", async () => {
    const { clerk, auth } = setup();
    await flush();
    clerk.set({ user: fakeUser("user_1"), session: new FakeSession("sess_p", "pending") });
    expect(auth.isSignedIn()).toBe(false);
    expect(auth.sessionId()).toBeNull();
    expect(auth.userId()).toBeNull();
  });

  it("[STA-06] a session with status active is signed in even before the user resolves", async () => {
    const { clerk, auth } = setup();
    await flush();
    clerk.set({ user: undefined, session: new FakeSession("sess_a") });
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.userId()).toBeNull();
    expect(auth.sessionId()).toBe("sess_a");
  });
});

describe("state mirroring: loading and batching", () => {
  it("[STA-07] an undefined user means the user is still loading", async () => {
    const { clerk, user } = setup();
    await flush();
    clerk.set({ user: undefined, session: undefined });
    expect(user.isLoaded()).toBe(false);
    expect(user.user()).toBeUndefined();
  });

  it("[STA-08] useUser reports loaded once the user is known, even when signed out", async () => {
    const { clerk, user } = setup();
    await flush();
    clerk.set({ user: null, session: null });
    expect(user.isLoaded()).toBe(true);
    expect(user.user()).toBeNull();
  });

  it("[STA-09] one Clerk event updates user, session and organization in a single batch", async () => {
    const clerk = new FakeClerk();
    const seen: string[] = [];
    mountProvider(
      () => {
        const auth = useAuth();
        useEffect(() => {
          seen.push(`${String(auth.userId())}|${String(auth.orgId())}`);
        });
        return auth;
      },
      { clerk },
    );
    await flush();
    const before = seen.length;
    clerk.set({
      user: fakeUser("user_1", [fakeMembership("org_1", "org:admin")]),
      session: new FakeSession("sess_1"),
      organization: fakeOrg("org_1"),
    });
    await flush();
    expect(seen.length - before).toBe(1);
    expect(seen[seen.length - 1]).toBe("user_1|org_1");
  });

  it("[STA-10] isLoaded follows clerk.loaded at each event, not only at load", async () => {
    const clerk = new FakeClerk();
    const { auth } = setup(clerk);
    await flush();
    expect(auth.isLoaded()).toBe(true);
    clerk.loaded = false;
    clerk.set({ user: null, session: null });
    expect(auth.isLoaded()).toBe(false);
  });

  it("[STA-11] the initial emission of an already loaded instance is applied at mount", () => {
    const clerk = new FakeClerk();
    clerk.loaded = true;
    clerk.user = fakeUser("user_init");
    clerk.session = new FakeSession("sess_init");
    const { auth } = setup(clerk);
    expect(auth.isLoaded()).toBe(true);
    expect(auth.userId()).toBe("user_init");
    expect(auth.sessionId()).toBe("sess_init");
  });

  it("[STA-12] an event that carries no session clears the previous session", async () => {
    const clerk = new FakeClerk();
    const { auth } = setup(clerk);
    await flush();
    clerk.set({ session: new FakeSession("sess_old") });
    clerk.set({ session: null });
    expect(auth.sessionId()).toBeNull();
  });
});

describe("state mirroring: organizations and roles", () => {
  it("[STA-13] the role comes from the membership in the active organization", async () => {
    const { clerk, auth } = setup();
    await flush();
    clerk.set({
      user: fakeUser("user_1", [fakeMembership("org_1", "org:admin")]),
      session: new FakeSession("sess_1"),
      organization: fakeOrg("org_1"),
    });
    expect(auth.orgId()).toBe("org_1");
    expect(auth.orgRole()).toBe("org:admin");
  });

  it("[STA-14] switching organization updates orgId and the role", async () => {
    const { clerk, auth } = setup();
    await flush();
    const user = fakeUser("user_1", [
      fakeMembership("org_1", "org:admin"),
      fakeMembership("org_2", "org:member"),
    ]);
    clerk.set({ user, session: new FakeSession("sess_1"), organization: fakeOrg("org_1") });
    clerk.set({ organization: fakeOrg("org_2") });
    expect(auth.orgId()).toBe("org_2");
    expect(auth.orgRole()).toBe("org:member");
  });

  it("[STA-15] no active organization means no org id and no role", async () => {
    const { clerk, auth, org } = setup();
    await flush();
    clerk.set({
      user: fakeUser("user_1", [fakeMembership("org_1", "org:admin")]),
      session: new FakeSession("sess_1"),
      organization: null,
    });
    expect(auth.orgId()).toBeNull();
    expect(auth.orgRole()).toBeNull();
    expect(org.organization()).toBeNull();
  });

  it("[STA-16] an active organization without a membership of the user has no role", async () => {
    const { clerk, auth, org } = setup();
    await flush();
    clerk.set({
      user: fakeUser("user_1", [fakeMembership("org_other", "org:admin")]),
      session: new FakeSession("sess_1"),
      organization: fakeOrg("org_1"),
    });
    expect(auth.orgId()).toBe("org_1");
    expect(auth.orgRole()).toBeNull();
    expect(org.membership()).toBeNull();
  });

  it("[STA-17] a user without organizationMemberships has no role", async () => {
    const { clerk, auth } = setup();
    await flush();
    clerk.set({
      user: { id: "user_1" },
      session: new FakeSession("sess_1"),
      organization: fakeOrg("org_1"),
    });
    expect(auth.orgRole()).toBeNull();
  });

  it("[STA-18] organization data is undefined while loading and reported as loaded afterward", async () => {
    const { clerk, org } = setup();
    await flush();
    clerk.set({ organization: undefined });
    expect(org.isLoaded()).toBe(false);
    clerk.set({ organization: null });
    expect(org.isLoaded()).toBe(true);
  });

  it("[STA-19] the membership role is recomputed when the membership list changes", async () => {
    const { clerk, auth } = setup();
    await flush();
    clerk.set({
      user: fakeUser("user_1", [fakeMembership("org_1", "org:member")]),
      session: new FakeSession("sess_1"),
      organization: fakeOrg("org_1"),
    });
    expect(auth.orgRole()).toBe("org:member");
    clerk.set({
      user: fakeUser("user_1", [fakeMembership("org_1", "org:admin")]),
    });
    expect(auth.orgRole()).toBe("org:admin");
  });
});

describe("state mirroring: the future sign-in", () => {
  it("[STA-20] clerk-js's future sign-in resource is mirrored into useSignIn, and a replaced resource follows", async () => {
    const clerk = new FakeClerk();
    const { signIn } = setup(clerk);
    await flush();
    const first = clerk.futureSignIn();
    expect(signIn.signIn()).toBe(first);
    expect(signIn.signIn()?.status).toBe("needs_identifier");
    const next = clerk.newFutureSignIn("needs_first_factor");
    clerk.setFutureSignIn(next);
    expect(signIn.signIn()).toBe(next);
  });

  it("[STA-21] the client is undefined until the SDK has loaded", () => {
    const clerk = new FakeClerk();
    const { signIn } = setup(clerk);
    expect(signIn.isLoaded()).toBe(false);
    expect(signIn.signIn()).toBeNull();
  });
});

describe("state mirroring: property over random event sequences (fixed seed)", () => {
  type Event =
    | { readonly kind: "signIn"; readonly user: string; readonly session: string }
    | { readonly kind: "signOut" }
    | { readonly kind: "org"; readonly org: string | null };

  const eventArb: fc.Arbitrary<Event> = fc.oneof(
    fc.record({
      kind: fc.constant("signIn" as const),
      user: fc.stringMatching(/^[a-z]{1,4}$/),
      session: fc.stringMatching(/^[a-z]{1,4}$/),
    }),
    fc.record({ kind: fc.constant("signOut" as const) }),
    fc.record({
      kind: fc.constant("org" as const),
      org: fc.option(fc.stringMatching(/^[a-z]{1,4}$/), { nil: null }),
    }),
  );

  it("[STA-22] after any sequence of events the mirrored state equals the last emitted state", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(eventArb, { maxLength: 25 }), async (events) => {
        cleanup();
        const clerk = new FakeClerk();
        const { auth } = setup(clerk);
        await flush();
        let expectedUser: string | null = null;
        let expectedSession: string | null = null;
        let expectedOrg: string | null = null;
        for (const event of events) {
          if (event.kind === "signIn") {
            clerk.set({ user: fakeUser(event.user), session: new FakeSession(event.session) });
            expectedUser = event.user;
            expectedSession = event.session;
          } else if (event.kind === "signOut") {
            clerk.set({ user: null, session: null, organization: null });
            expectedUser = null;
            expectedSession = null;
            expectedOrg = null;
          } else {
            clerk.set({ organization: event.org === null ? null : fakeOrg(event.org) });
            expectedOrg = event.org;
          }
        }
        expect(auth.userId()).toBe(expectedUser);
        expect(auth.sessionId()).toBe(expectedSession);
        expect(auth.orgId()).toBe(
          expectedOrg === null || expectedSession === null ? null : expectedOrg,
        );
      }),
      { seed: 20261009, numRuns: 120 },
    );
  });
});
