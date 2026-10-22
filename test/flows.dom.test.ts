import { cleanup, flush, render } from "@shadow-js/testing/dom";
import { ErrorBoundary } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ClerkClientLike,
  ClerkFetchStatus,
  ClerkFlowErrors,
  ClerkFlowResult,
} from "../src/index";
import {
  HandleSSOCallback,
  type HandleSSOCallbackProps,
  useAuth,
  useSignIn,
  useSignUp,
} from "../src/index";
import { ClerkProvider } from "../src/provider";
import { KEY, mountProvider } from "./support/app";
import {
  FakeClerk,
  FakeSession,
  type FakeSignInFuture,
  type FakeSignUpFuture,
  fakeUser,
} from "./support/fake-clerk";

/**
 * Headless flows of clerk-js's future API, run against the fake with no network. Each test drives the resource the way
 * an app does (create, send, verify, submit, activate) and reads the outcome through the hooks: `signIn()`/`signUp()`,
 * `errors()`, `fetchStatus()` and `setActive`. The resource's methods are scripted here to act as clerk-js does, so the
 * tests check the hooks and the provider, not clerk-js itself.
 */

afterEach(() => cleanup());

/** The flow a request belongs to. */
type Flow = "signIn" | "signUp";

const NO_ERRORS: ClerkFlowErrors = { fields: {}, raw: null, global: null };
const OK: ClerkFlowResult = { error: null };
/** The one-time code the scripted email flows accept. Test data only. */
const GOOD_CODE = "424242";

/** The sign-in resource the fake holds, asserted to exist. */
function signInOf(clerk: FakeClerk): FakeSignInFuture {
  const resource = clerk.futureSignIn();
  if (resource === null) throw new Error("the fake has no sign-in resource");
  return resource;
}

/** The sign-up resource the fake holds, asserted to exist. */
function signUpOf(clerk: FakeClerk): FakeSignUpFuture {
  const resource = clerk.futureSignUp();
  if (resource === null) throw new Error("the fake has no sign-up resource");
  return resource;
}

/** The clerk-js state of the fake, asserted to exist. */
function stateOf(clerk: FakeClerk) {
  const state = clerk.__internal_state;
  if (state === undefined) throw new Error("the fake has no clerk-js state");
  return state;
}

/** The names of the recorded calls that start with `prefix`, in order. */
function callNames(clerk: FakeClerk, prefix: string): string[] {
  return clerk.calls.map((call) => call.method).filter((name) => name.startsWith(prefix));
}

/** Writes a call to the fake's record, as the fake's own methods do. */
function record(clerk: FakeClerk, method: string, args: readonly unknown[]): void {
  clerk.calls.push({ method, args });
}

/** Sets the fetch status of a flow, as clerk-js does while a request runs. */
function setFetch(clerk: FakeClerk, flow: Flow, status: ClerkFetchStatus): void {
  const state = stateOf(clerk);
  if (flow === "signIn") state.signInFetch.set(status);
  else state.signUpFetch.set(status);
}

/** Sets the errors of a flow, the errors of its last fetch. */
function setErrors(clerk: FakeClerk, flow: Flow, errors: ClerkFlowErrors): void {
  const state = stateOf(clerk);
  if (flow === "signIn") state.signInErrors.set(errors);
  else state.signUpErrors.set(errors);
}

/**
 * Runs one request of a flow the way clerk-js does. The fetch status is `fetching` while `run` is pending and `idle`
 * again once it settles, also when it rejects, which is passed on unchanged. A request that succeeds leaves no errors:
 * they are the errors of the last fetch.
 */
async function request(
  clerk: FakeClerk,
  flow: Flow,
  run: () => Promise<ClerkFlowResult>,
): Promise<ClerkFlowResult> {
  setFetch(clerk, flow, "fetching");
  try {
    const result = await run();
    if (result.error === null) setErrors(clerk, flow, NO_ERRORS);
    return result;
  } finally {
    setFetch(clerk, flow, "idle");
  }
}

/** Errors for one field of a flow, as clerk-js reports a wrong value. */
function fieldErrors(field: string, message: string, code: string): ClerkFlowErrors {
  return {
    fields: { [field]: { message, code } },
    raw: [{ code }],
    global: null,
  };
}

/** Mounts the hooks of the flows and the auth state under a fake. */
function mountFlows(clerk: FakeClerk) {
  return mountProvider(() => ({ signIn: useSignIn(), signUp: useSignUp(), auth: useAuth() }), {
    clerk,
  });
}

describe("headless sign-in flows (useSignIn)", () => {
  it("[FLW-01] a password sign-in: fetching then idle, the attempt completes, and setActive activates its session", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signInOf(clerk);
    const fetchSeen: ClerkFetchStatus[] = [];
    Object.assign(attempt, {
      password: (params: object) =>
        request(clerk, "signIn", () => {
          // Read while the request is pending: the hook must already say "fetching".
          fetchSeen.push(value.signIn.fetchStatus());
          record(clerk, "signIn.password", [params]);
          attempt.createdSessionId = "sess_pw";
          attempt.setStatus("complete");
          return Promise.resolve(OK);
        }),
    });

    const result = await value.signIn.signIn()?.password({
      identifier: "ada@example.com",
      password: "test-password-1",
    });
    fetchSeen.push(value.signIn.fetchStatus());

    expect(result).toEqual(OK);
    expect(fetchSeen).toEqual(["fetching", "idle"]);
    expect(value.signIn.errors()).toEqual(NO_ERRORS);
    expect(value.signIn.signIn()?.status).toBe("complete");
    const sessionId = value.signIn.signIn()?.createdSessionId ?? null;
    expect(sessionId).toBe("sess_pw");

    await value.signIn.setActive({ session: sessionId });
    expect(clerk.callsTo("setActive").map((call) => call.args)).toEqual([[{ session: "sess_pw" }]]);
    // clerk-js emits the new session as one event, which the hooks then read.
    clerk.set({ session: new FakeSession("sess_pw"), user: fakeUser("user_1") });
    await flush();
    expect(value.auth.isSignedIn()).toBe(true);
    expect(value.auth.sessionId()).toBe("sess_pw");
  });

  it("[FLW-02] a wrong password keeps the step: the error is in errors(), the fetch ends idle, and nothing is activated", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signInOf(clerk);
    attempt.identifier = "ada@example.com";
    attempt.setStatus("needs_first_factor");
    attempt.passwordFailure = { message: "Password is incorrect." };
    const original = attempt.password.bind(attempt);
    const fetchSeen: ClerkFetchStatus[] = [];
    Object.assign(attempt, {
      password: (params: object) =>
        request(clerk, "signIn", () => {
          fetchSeen.push(value.signIn.fetchStatus());
          return original(params);
        }),
    });

    const result = await value.signIn.signIn()?.password({ password: "wrong-password" });
    fetchSeen.push(value.signIn.fetchStatus());

    expect(result?.error?.message).toBe("Password is incorrect.");
    expect(fetchSeen).toEqual(["fetching", "idle"]);
    expect(value.signIn.errors().fields["password"]?.message).toBe("Password is incorrect.");
    expect(value.signIn.signIn()?.status).toBe("needs_first_factor");
    expect(callNames(clerk, "setActive")).toEqual([]);
    expect(value.auth.isSignedIn()).toBe(false);
  });

  it("[FLW-03] an email code sign-in: create, send, a wrong code shows its error, the right code completes and activates", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signInOf(clerk);
    Object.assign(attempt, {
      create: (params: object) =>
        request(clerk, "signIn", () => {
          record(clerk, "signIn.create", [params]);
          attempt.identifier = "ada@example.com";
          attempt.setStatus("needs_first_factor");
          return Promise.resolve(OK);
        }),
    });
    Object.assign(attempt.emailCode, {
      sendCode: (params?: object) =>
        request(clerk, "signIn", () => {
          record(clerk, "signIn.emailCode.sendCode", [params]);
          return Promise.resolve(OK);
        }),
      verifyCode: (params: { readonly code: string }) =>
        request(clerk, "signIn", () => {
          record(clerk, "signIn.emailCode.verifyCode", [params]);
          if (params.code !== GOOD_CODE) {
            setErrors(
              clerk,
              "signIn",
              fieldErrors("code", "That code is incorrect.", "form_code_incorrect"),
            );
            return Promise.resolve({
              error: { message: "That code is incorrect.", code: "form_code_incorrect" },
            });
          }
          attempt.createdSessionId = "sess_email";
          attempt.setStatus("complete");
          return Promise.resolve(OK);
        }),
    });

    await value.signIn.signIn()?.create({ identifier: "ada@example.com" });
    expect(value.signIn.signIn()?.status).toBe("needs_first_factor");
    const sent = await value.signIn
      .signIn()
      ?.emailCode.sendCode({ emailAddress: "ada@example.com" });
    expect(sent).toEqual(OK);

    const wrong = await value.signIn.signIn()?.emailCode.verifyCode({ code: "000000" });
    expect(wrong?.error?.code).toBe("form_code_incorrect");
    expect(value.signIn.errors().fields["code"]?.message).toBe("That code is incorrect.");
    expect(value.signIn.signIn()?.status).toBe("needs_first_factor");

    const right = await value.signIn.signIn()?.emailCode.verifyCode({ code: GOOD_CODE });
    expect(right).toEqual(OK);
    expect(value.signIn.errors()).toEqual(NO_ERRORS);
    expect(value.signIn.signIn()?.status).toBe("complete");

    // The order matters: the code is sent before it is checked, and checked twice (wrong, then right).
    expect(callNames(clerk, "signIn.")).toEqual([
      "signIn.create",
      "signIn.emailCode.sendCode",
      "signIn.emailCode.verifyCode",
      "signIn.emailCode.verifyCode",
    ]);
    await value.signIn.setActive({ session: value.signIn.signIn()?.createdSessionId ?? null });
    expect(clerk.callsTo("setActive").map((call) => call.args)).toEqual([
      [{ session: "sess_email" }],
    ]);
  });

  it("[FLW-04] a password reset: reset() returns to the first step with no request, then the reset code and submitPassword complete it", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signInOf(clerk);
    Object.assign(attempt, {
      create: (params: object) =>
        request(clerk, "signIn", () => {
          record(clerk, "signIn.create", [params]);
          attempt.identifier = "ada@example.com";
          attempt.setStatus("needs_first_factor");
          return Promise.resolve(OK);
        }),
    });
    Object.assign(attempt.resetPasswordEmailCode, {
      sendCode: () =>
        request(clerk, "signIn", () => {
          record(clerk, "signIn.resetPasswordEmailCode.sendCode", []);
          return Promise.resolve(OK);
        }),
      verifyCode: (params: { readonly code: string }) =>
        request(clerk, "signIn", () => {
          record(clerk, "signIn.resetPasswordEmailCode.verifyCode", [params]);
          if (params.code !== GOOD_CODE) {
            setErrors(
              clerk,
              "signIn",
              fieldErrors("code", "That code is incorrect.", "form_code_incorrect"),
            );
            return Promise.resolve({
              error: { message: "That code is incorrect.", code: "form_code_incorrect" },
            });
          }
          attempt.setStatus("needs_new_password");
          return Promise.resolve(OK);
        }),
      submitPassword: (params: object) =>
        request(clerk, "signIn", () => {
          record(clerk, "signIn.resetPasswordEmailCode.submitPassword", [params]);
          attempt.createdSessionId = "sess_reset";
          attempt.setStatus("complete");
          return Promise.resolve(OK);
        }),
    });

    // The reset path: the attempt starts again without a request.
    await value.signIn.signIn()?.create({ identifier: "ada@example.com" });
    expect(value.signIn.signIn()?.status).toBe("needs_first_factor");
    expect(await value.signIn.signIn()?.reset()).toEqual(OK);
    expect(value.signIn.signIn()?.status).toBe("needs_identifier");
    expect(value.signIn.signIn()?.identifier).toBeNull();
    expect(callNames(clerk, "signIn.")).toEqual(["signIn.create", "signIn.reset"]);

    // The follow-up steps: send the reset code, verify it, then submit the new password.
    await value.signIn.signIn()?.create({ identifier: "ada@example.com" });
    expect(await value.signIn.signIn()?.resetPasswordEmailCode.sendCode()).toEqual(OK);
    expect(
      await value.signIn.signIn()?.resetPasswordEmailCode.verifyCode({ code: GOOD_CODE }),
    ).toEqual(OK);
    expect(value.signIn.signIn()?.status).toBe("needs_new_password");
    const submitted = await value.signIn.signIn()?.resetPasswordEmailCode.submitPassword({
      password: "test-password-2",
      signOutOfOtherSessions: true,
    });
    expect(submitted).toEqual(OK);
    expect(value.signIn.signIn()?.status).toBe("complete");
    expect(callNames(clerk, "signIn.resetPasswordEmailCode.submitPassword")).toHaveLength(1);

    await value.signIn.setActive({ session: "sess_reset" });
    expect(clerk.callsTo("setActive").map((call) => call.args)).toEqual([
      [{ session: "sess_reset" }],
    ]);
  });

  it("[FLW-05] a wrong password reset code keeps the attempt at its step and shows the error", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signInOf(clerk);
    attempt.setStatus("needs_first_factor");
    Object.assign(attempt.resetPasswordEmailCode, {
      verifyCode: (params: { readonly code: string }) =>
        request(clerk, "signIn", () => {
          record(clerk, "signIn.resetPasswordEmailCode.verifyCode", [params]);
          setErrors(
            clerk,
            "signIn",
            fieldErrors("code", "That code is incorrect.", "form_code_incorrect"),
          );
          return Promise.resolve({
            error: { message: "That code is incorrect.", code: "form_code_incorrect" },
          });
        }),
    });

    const checked = await value.signIn
      .signIn()
      ?.resetPasswordEmailCode.verifyCode({ code: "000000" });
    expect(checked?.error?.message).toBe("That code is incorrect.");
    expect(value.signIn.errors().fields["code"]?.message).toBe("That code is incorrect.");
    expect(value.signIn.signIn()?.status).toBe("needs_first_factor");
    expect(value.signIn.fetchStatus()).toBe("idle");
  });

  it("[FLW-06] an SSO start hands the parameters to clerk-js unchanged and resolves when the redirect is sent", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signInOf(clerk);
    const fetchSeen: ClerkFetchStatus[] = [];
    Object.assign(attempt, {
      sso: (params: object) =>
        request(clerk, "signIn", () => {
          fetchSeen.push(value.signIn.fetchStatus());
          record(clerk, "signIn.sso", [params]);
          return Promise.resolve(OK);
        }),
    });
    const params = {
      strategy: "oauth_google",
      redirectUrl: "/",
      redirectCallbackUrl: "/sign-in/sso-callback",
    };

    const result = await value.signIn.signIn()?.sso(params);
    fetchSeen.push(value.signIn.fetchStatus());

    expect(result).toEqual(OK);
    expect(fetchSeen).toEqual(["fetching", "idle"]);
    expect(clerk.callsTo("signIn.sso").map((call) => call.args)).toEqual([[params]]);
  });

  it("[FLW-07] a provider error of an SSO start is in errors().global", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signInOf(clerk);
    Object.assign(attempt, {
      sso: () =>
        request(clerk, "signIn", () => {
          setErrors(clerk, "signIn", {
            fields: {},
            raw: [{ code: "oauth_provider_disabled" }],
            global: [
              { message: "Google sign-in is not enabled.", code: "oauth_provider_disabled" },
            ],
          });
          return Promise.resolve({ error: { message: "Google sign-in is not enabled." } });
        }),
    });

    const result = await value.signIn.signIn()?.sso({
      strategy: "oauth_google",
      redirectUrl: "/",
      redirectCallbackUrl: "/sign-in/sso-callback",
    });

    expect(result?.error?.message).toBe("Google sign-in is not enabled.");
    expect(value.signIn.errors().global?.[0]?.message).toBe("Google sign-in is not enabled.");
    expect(value.signIn.fetchStatus()).toBe("idle");
  });

  it("[FLW-08] a rejected SSO start is not swallowed: the call rejects, the fetch ends idle, and no error is recorded", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signInOf(clerk);
    Object.assign(attempt, {
      sso: () => request(clerk, "signIn", () => Promise.reject(new Error("network down"))),
    });

    await expect(
      value.signIn.signIn()?.sso({
        strategy: "oauth_google",
        redirectUrl: "/",
        redirectCallbackUrl: "/sign-in/sso-callback",
      }),
    ).rejects.toThrow("network down");
    expect(value.signIn.fetchStatus()).toBe("idle");
    expect(value.signIn.errors()).toEqual(NO_ERRORS);
  });

  it("[FLW-09] a rejected setActive is not swallowed: the caller's promise rejects with the same error", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    clerk.setActiveFailure = { error: new Error("session expired") };

    await expect(value.signIn.setActive({ session: "sess_pw" })).rejects.toThrow("session expired");
    expect(clerk.callsTo("setActive")).toHaveLength(1);
    expect(value.auth.isSignedIn()).toBe(false);
  });
});

describe("headless sign-up flows (useSignUp)", () => {
  it("[FLW-10] a password sign-up leaves the attempt to be verified, the email code completes it, and setActive activates it", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signUpOf(clerk);
    Object.assign(attempt, {
      password: (params: object) =>
        request(clerk, "signUp", () => {
          record(clerk, "signUp.password", [params]);
          attempt.emailAddress = "ada@example.com";
          attempt.setStatus("missing_requirements");
          return Promise.resolve(OK);
        }),
    });
    Object.assign(attempt.verifications, {
      sendEmailCode: () =>
        request(clerk, "signUp", () => {
          record(clerk, "signUp.verifications.sendEmailCode", []);
          return Promise.resolve(OK);
        }),
      verifyEmailCode: (params: { readonly code: string }) =>
        request(clerk, "signUp", () => {
          record(clerk, "signUp.verifications.verifyEmailCode", [params]);
          if (params.code !== GOOD_CODE) {
            setErrors(
              clerk,
              "signUp",
              fieldErrors("code", "That code is incorrect.", "form_code_incorrect"),
            );
            return Promise.resolve({
              error: { message: "That code is incorrect.", code: "form_code_incorrect" },
            });
          }
          attempt.createdSessionId = "sess_up";
          attempt.setStatus("complete");
          return Promise.resolve(OK);
        }),
    });

    const created = await value.signUp.signUp()?.password({
      emailAddress: "ada@example.com",
      password: "test-password-1",
    });
    expect(created).toEqual(OK);
    expect(value.signUp.signUp()?.status).toBe("missing_requirements");

    expect(await value.signUp.signUp()?.verifications.sendEmailCode()).toEqual(OK);
    const wrong = await value.signUp.signUp()?.verifications.verifyEmailCode({ code: "000000" });
    expect(wrong?.error?.message).toBe("That code is incorrect.");
    expect(value.signUp.errors().fields["code"]?.message).toBe("That code is incorrect.");
    expect(value.signUp.signUp()?.status).toBe("missing_requirements");

    expect(await value.signUp.signUp()?.verifications.verifyEmailCode({ code: GOOD_CODE })).toEqual(
      OK,
    );
    expect(value.signUp.errors()).toEqual(NO_ERRORS);
    expect(value.signUp.signUp()?.status).toBe("complete");
    expect(callNames(clerk, "signUp.")).toEqual([
      "signUp.password",
      "signUp.verifications.sendEmailCode",
      "signUp.verifications.verifyEmailCode",
      "signUp.verifications.verifyEmailCode",
    ]);

    await value.signUp.setActive({ session: value.signUp.signUp()?.createdSessionId ?? null });
    expect(clerk.callsTo("setActive").map((call) => call.args)).toEqual([[{ session: "sess_up" }]]);
  });

  it("[FLW-11] a sign-up password the instance refuses shows its error and keeps the attempt", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signUpOf(clerk);
    Object.assign(attempt, {
      password: () =>
        request(clerk, "signUp", () => {
          setErrors(
            clerk,
            "signUp",
            fieldErrors("password", "Password is too short.", "form_password_length_too_short"),
          );
          return Promise.resolve({ error: { message: "Password is too short." } });
        }),
    });

    const result = await value.signUp.signUp()?.password({
      emailAddress: "ada@example.com",
      password: "short",
    });

    expect(result?.error?.message).toBe("Password is too short.");
    expect(value.signUp.errors().fields["password"]?.message).toBe("Password is too short.");
    expect(value.signUp.fetchStatus()).toBe("idle");
    expect(value.signUp.signUp()?.status).toBe("missing_requirements");
  });

  it("[FLW-12] a rejected sign-up create is not swallowed: the call rejects and the fetch ends idle", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const attempt = signUpOf(clerk);
    Object.assign(attempt, {
      create: () =>
        request(clerk, "signUp", () => Promise.reject(new Error("service unavailable"))),
    });

    await expect(
      value.signUp.signUp()?.create({ emailAddress: "ada@example.com" }),
    ).rejects.toThrow("service unavailable");
    expect(value.signUp.fetchStatus()).toBe("idle");
    expect(value.signUp.errors()).toEqual(NO_ERRORS);
  });

  it("[FLW-13] a sign-up SSO start hands its parameters to clerk-js unchanged", async () => {
    const clerk = new FakeClerk();
    const { value } = mountFlows(clerk);
    await flush();
    const params = {
      strategy: "oauth_github",
      redirectUrl: "/",
      redirectCallbackUrl: "/sign-up/sso-callback",
      emailAddress: "ada@example.com",
    };

    const result = await value.signUp.signUp()?.sso(params);

    expect(result).toEqual(OK);
    expect(clerk.callsTo("signUp.sso").map((call) => call.args)).toEqual([[params]]);
  });
});

/** The attempts a client holds: clerk-js's `client.signIn` and `client.signUp`, as the callback reads them. */
interface ClientAttempts {
  readonly signIn: unknown;
  readonly signUp: unknown;
}

/** A fake whose client holds the given attempts once it loads. */
class CallbackClerk extends FakeClerk {
  private readonly attempts: ClientAttempts;

  constructor(attempts: ClientAttempts) {
    super();
    this.attempts = attempts;
  }

  // The attempts must be in place before the first emit, because the callback runs on it.
  override emit(): void {
    if (this.loaded) {
      this.client = {
        signIn: this.attempts.signIn,
        signUp: this.attempts.signUp,
      } as unknown as ClerkClientLike;
    }
    super.emit();
  }
}

/** Mounts the SSO callback route under a loaded fake and returns the navigations it made. */
async function mountCallback(clerk: FakeClerk, props: HandleSSOCallbackProps = {}) {
  const visited: { to: string; replace: boolean }[] = [];
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
  return visited;
}

describe("headless SSO flows (sso() and HandleSSOCallback)", () => {
  it("[FLW-14] an SSO sign-in: sso() starts it, and the callback route activates the session and goes to afterSignInUrl", async () => {
    const clerk = new CallbackClerk({
      signIn: { status: "complete", createdSessionId: "sess_sso" },
      signUp: { status: null },
    });
    const { value } = mountFlows(clerk);
    await flush();
    const params = {
      strategy: "oauth_google",
      redirectUrl: "/dashboard",
      redirectCallbackUrl: "/sign-in/sso-callback",
    };
    await value.signIn.signIn()?.sso(params);
    expect(clerk.callsTo("signIn.sso").map((call) => call.args)).toEqual([[params]]);

    // The browser comes back on the callback route, where the page mounts HandleSSOCallback.
    const visited = await mountCallback(clerk, { afterSignInUrl: "/dashboard" });

    expect(clerk.callsTo("setActive").map((call) => call.args)).toEqual([
      [{ session: "sess_sso" }],
    ]);
    expect(visited).toEqual([{ to: "/dashboard", replace: true }]);
  });

  it("[FLW-15] an SSO sign-up: the callback route activates the completed sign-up and goes to afterSignUpUrl", async () => {
    const clerk = new CallbackClerk({
      signIn: { status: null },
      signUp: { status: "complete", createdSessionId: "sess_sso_up" },
    });
    const { value } = mountFlows(clerk);
    await flush();
    const params = {
      strategy: "oauth_github",
      redirectUrl: "/welcome",
      redirectCallbackUrl: "/sign-up/sso-callback",
    };
    await value.signUp.signUp()?.sso(params);
    expect(clerk.callsTo("signUp.sso").map((call) => call.args)).toEqual([[params]]);

    const visited = await mountCallback(clerk, { afterSignUpUrl: "/welcome" });

    expect(clerk.callsTo("setActive").map((call) => call.args)).toEqual([
      [{ session: "sess_sso_up" }],
    ]);
    expect(visited).toEqual([{ to: "/welcome", replace: true }]);
  });

  it("[FLW-16] a rejected setActive in the callback is not swallowed: it reaches the nearest ErrorBoundary", async () => {
    const clerk = new CallbackClerk({
      signIn: { status: "complete", createdSessionId: "sess_sso" },
      signUp: { status: null },
    });
    clerk.setActiveFailure = { error: new Error("session expired") };
    const container = document.createElement("div");
    document.body.append(container);
    render(
      () =>
        ErrorBoundary({
          fallback: (error: unknown) =>
            `fallback:${error instanceof Error ? error.message : String(error)}`,
          get children() {
            return ClerkProvider({
              publishableKey: KEY,
              clerk,
              get children() {
                HandleSSOCallback({ navigate: () => undefined });
                return "app";
              },
            });
          },
        }),
      { container },
    );
    await flush();
    await flush();

    expect(container.textContent).toBe("fallback:session expired");
  });
});
