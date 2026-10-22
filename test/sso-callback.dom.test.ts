import { cleanup, flush } from "@shadow-js/testing/dom";
import { afterEach, describe, expect, it } from "vitest";
import { finishSsoCallback } from "../src/components/sso-callback";
import { HandleSSOCallback } from "../src/index";
import { mountProvider } from "./support/app";
import { FakeClerk } from "./support/fake-clerk";

afterEach(() => cleanup());

/** A fake whose client holds the given sign-in and sign-up attempts once it loads. */
class AttemptsClerk extends FakeClerk {
  private readonly attempts: { signIn: unknown; signUp: unknown };

  constructor(attempts: { signIn: unknown; signUp: unknown }) {
    super();
    this.attempts = attempts;
  }

  // The fake sets its default client and emits in `load`: the attempts must be in place by then, because
  // the callback runs on that first emit.
  override emit(): void {
    if (this.loaded) {
      this.client = { signIn: this.attempts.signIn, signUp: this.attempts.signUp } as never;
    }
    super.emit();
  }
}

/** A creatable sign-up attempt (what `client.signUp` is in clerk-js): `create({ transfer })` resolves to it. */
function signUpAttempt(status: string | null, createdSessionId: string | null = null) {
  return {
    status,
    createdSessionId,
    create: async () => signUpAttempt("complete", "sess_transferred"),
  };
}

/** Mounts the callback under a loaded fake with the given attempts; returns the navigations it made. */
async function mounted(
  attempts: { signIn: unknown; signUp: unknown },
  props: {
    signInUrl?: string;
    signUpUrl?: string;
    afterSignInUrl?: string;
    afterSignUpUrl?: string;
  } = {},
) {
  const clerk = new AttemptsClerk(attempts);
  const visited: Array<{ to: string; replace: boolean }> = [];
  mountProvider(
    () => {
      HandleSSOCallback({
        ...props,
        navigate: (to, options) => {
          visited.push({ to, replace: options.replace });
        },
      });
      return true;
    },
    { clerk },
  );
  await flush();
  await flush();
  return { clerk, visited };
}

describe("HandleSSOCallback (Clerk's state machine, in @shadow-js/clerk)", () => {
  it("[SSO-01] a completed sign-in activates its session and goes to afterSignInUrl, replacing the entry", async () => {
    const { clerk, visited } = await mounted(
      { signIn: { status: "complete", createdSessionId: "sess_1" }, signUp: { status: null } },
      { afterSignInUrl: "/dashboard" },
    );
    expect(clerk.callsTo("setActive").map((call) => call.args[0])).toEqual([{ session: "sess_1" }]);
    expect(visited).toEqual([{ to: "/dashboard", replace: true }]);
  });

  it("[SSO-02] a first-time account (transferable sign-in) is transferred to a sign-up; a completed one goes to afterSignUpUrl", async () => {
    const { clerk, visited } = await mounted(
      { signIn: { status: "needs_identifier", isTransferable: true }, signUp: signUpAttempt(null) },
      { afterSignUpUrl: "/welcome" },
    );
    expect(clerk.callsTo("setActive").map((call) => call.args[0])).toEqual([
      { session: "sess_transferred" },
    ]);
    expect(visited).toEqual([{ to: "/welcome", replace: true }]);
  });

  it("[SSO-03] a transfer that does not complete sends the browser to signUpUrl", async () => {
    const unfinished = {
      status: "missing_requirements",
      createdSessionId: null,
      create: async () => ({ status: "missing_requirements", createdSessionId: null }),
    };
    const { visited } = await mounted(
      { signIn: { status: "needs_identifier", isTransferable: true }, signUp: unfinished },
      { signUpUrl: "/join" },
    );
    expect(visited).toEqual([{ to: "/join", replace: true }]);
  });

  it("[SSO-04] a sign-in that needs a second factor or a new password goes to signInUrl", async () => {
    for (const status of ["needs_second_factor", "needs_new_password"]) {
      const { visited } = await mounted(
        { signIn: { status, isTransferable: false }, signUp: { status: null } },
        { signInUrl: "/sign-in?step=2" },
      );
      expect(visited, status).toEqual([{ to: "/sign-in?step=2", replace: true }]);
    }
  });

  it("[SSO-05] nothing final yet waits: no navigation, no session change", async () => {
    const { clerk, visited } = await mounted({
      signIn: { status: null, isTransferable: false },
      signUp: { status: null },
    });
    expect(visited).toEqual([]);
    expect(clerk.count("setActive")).toBe(0);
  });

  it("[SSO-06] a default route is /sign-in for steps, /sign-up for transfers, / after sign-in", async () => {
    const step = await mounted({
      signIn: { status: "needs_second_factor" },
      signUp: { status: null },
    });
    expect(step.visited).toEqual([{ to: "/sign-in", replace: true }]);
    const done = await mounted({
      signIn: { status: "complete", createdSessionId: "s" },
      signUp: { status: null },
    });
    expect(done.visited).toEqual([{ to: "/", replace: true }]);
  });

  it("[SSO-07] the state machine runs once per mount, however often the provider re-renders", async () => {
    const clerk = new AttemptsClerk({
      signIn: { status: "complete", createdSessionId: "sess_x" },
      signUp: { status: null },
    });
    mountProvider(
      () => {
        HandleSSOCallback({ navigate: () => undefined });
        return true;
      },
      { clerk },
    );
    await flush();
    await flush();
    await flush();
    expect(clerk.count("setActive")).toBe(1);
  });

  it("[SSO-08] finishSsoCallback: a transferable sign-in with no creatable sign-up is not transferred; the sign-in page takes the step", async () => {
    const calls: string[] = [];
    const navigations: string[] = [];
    const outcome = await finishSsoCallback(
      { setActive: async () => undefined },
      { signIn: { status: "needs_identifier", isTransferable: true }, signUp: { status: null } },
      {
        signIn: "/sign-in",
        signUp: "/sign-up",
        afterSignIn: "/",
        afterSignUp: "/",
        navigate: (to) => {
          calls.push("navigate");
          navigations.push(to);
        },
      },
    );
    expect(outcome).toBe("sign-in");
    expect(navigations).toEqual(["/sign-in"]);
    expect(calls).toEqual(["navigate"]);
  });
});
