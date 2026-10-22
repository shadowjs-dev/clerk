import type {
  ClerkClientLike,
  ClerkFetchStatus,
  ClerkFlowErrors,
  ClerkFlowResult,
  ClerkLike,
  ClerkListener,
  ClerkMembershipLike,
  ClerkOrganizationLike,
  ClerkResourcesLike,
  ClerkReverificationProps,
  ClerkSessionLike,
  ClerkTokenOptions,
  ClerkUserLike,
} from "../../src/index";

/** One recorded call on the fake. `node` is the mount target for the UI methods. */
export interface FakeCall {
  readonly method: string;
  readonly args: readonly unknown[];
  readonly node?: HTMLDivElement;
}

/** A session that returns scripted tokens and records every `getToken` call. */
export class FakeSession implements ClerkSessionLike {
  readonly id: string;
  readonly status: string;
  /** Options of each `getToken` call, in order. `undefined` for a call without options. */
  readonly tokenCalls: (ClerkTokenOptions | undefined)[] = [];
  /** The token returned for any call; `null` simulates a session without a token. */
  token: string | null = "token-1";
  /** When set, `getToken` rejects with this value. */
  failure: { readonly error: unknown } | undefined = undefined;
  /** Resolves `getToken` only when the test calls the returned function (for in-flight races). */
  hold: Promise<void> | undefined = undefined;
  /** The organization the session was last used with (`setActive({ organization })` in any tab). */
  lastActiveOrganizationId: string | null | undefined = undefined;

  constructor(id = "sess_1", status = "active") {
    this.id = id;
    this.status = status;
  }

  async getToken(options?: ClerkTokenOptions): Promise<string | null> {
    this.tokenCalls.push(options);
    if (this.hold !== undefined) await this.hold;
    if (this.failure !== undefined) throw this.failure.error;
    return this.token;
  }
}

/**
 * A tiny reactive core for the fake clerk-js state: a cell that notifies its readers, a derived value, and an effect that
 * runs a callback now and after each change it read. It models what clerk-js's `__internal_state` does with alien-signals,
 * with synchronous propagation and no timers.
 */
type Subscribers = Set<Effect>;
let observer: Effect | undefined;

/** A value with readers. A read inside an effect subscribes that effect; a write notifies every reader. */
class Cell<T> {
  private value: T;
  readonly subscribers: Subscribers = new Set<Effect>();

  constructor(value: T) {
    this.value = value;
  }

  get(): T {
    if (observer !== undefined) {
      this.subscribers.add(observer);
      observer.deps.add(this.subscribers);
    }
    return this.value;
  }

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const effect of [...this.subscribers]) effect.run();
  }
}

/** An effect: the callback runs at once and again after each change of a cell it read in its last run. */
class Effect {
  readonly deps: Set<Subscribers> = new Set<Subscribers>();
  private active = true;
  private readonly fn: () => void;

  constructor(fn: () => void) {
    this.fn = fn;
  }

  run(): void {
    if (!this.active) return;
    for (const subscribers of this.deps) subscribers.delete(this);
    this.deps.clear();
    const previous = observer;
    observer = this;
    try {
      this.fn();
    } finally {
      observer = previous;
    }
  }

  dispose(): void {
    this.active = false;
    for (const subscribers of this.deps) subscribers.delete(this);
    this.deps.clear();
  }
}

/** A value derived from cells: recomputed (a new object each time) whenever one of them changes. */
function derived<T>(compute: () => T): () => T {
  const cell = new Cell<T | undefined>(undefined);
  new Effect(() => cell.set(compute())).run();
  return () => cell.get() as T;
}

const NO_ERRORS: ClerkFlowErrors = { fields: {}, raw: null, global: null };

/** The result every fake flow method resolves to when it succeeds. */
function ok(): Promise<ClerkFlowResult> {
  return Promise.resolve({ error: null });
}

/**
 * A fake of clerk-js's future sign-in resource. `reset()` clears the attempt back to `needs_identifier` and notifies
 * the state, so a mounted provider re-reads it. `sso()` records its arguments and does not redirect.
 */
export class FakeSignInFuture {
  readonly statusCell: Cell<string>;
  identifier: string | null = null;
  createdSessionId: string | null = null;
  isTransferable = false;
  readonly supportedFirstFactors: { readonly strategy: string }[] = [];
  readonly supportedSecondFactors: { readonly strategy: string }[] = [];
  readonly firstFactorVerification: { readonly status: string | null } = { status: null };
  readonly secondFactorVerification: { readonly status: string | null } = { status: null };
  readonly emailCode = {
    sendCode: (): Promise<ClerkFlowResult> => ok(),
    verifyCode: (): Promise<ClerkFlowResult> => ok(),
  };
  /** clerk-js's password-reset factor. The flow tests script its methods; the defaults only resolve. */
  readonly resetPasswordEmailCode = {
    sendCode: (): Promise<ClerkFlowResult> => ok(),
    verifyCode: (): Promise<ClerkFlowResult> => ok(),
    submitPassword: (): Promise<ClerkFlowResult> => ok(),
  };
  /** Failure returned by `password()`, for error-mirroring tests. */
  passwordFailure: { readonly message: string } | undefined = undefined;

  private readonly state: FakeInternalState;

  constructor(state: FakeInternalState, status: string) {
    this.state = state;
    this.statusCell = new Cell(status);
  }

  get status(): string {
    return this.statusCell.get();
  }

  /** Sets the status and notifies the state (a resource update in clerk-js). */
  setStatus(status: string): void {
    this.statusCell.set(status);
    this.state.notify();
  }

  reset(): Promise<ClerkFlowResult> {
    this.state.record("signIn.reset", []);
    this.identifier = null;
    this.setStatus("needs_identifier");
    return ok();
  }

  sso(params: object): Promise<ClerkFlowResult> {
    this.state.record("signIn.sso", [params]);
    return ok();
  }

  create(params: object): Promise<ClerkFlowResult> {
    this.state.record("signIn.create", [params]);
    return ok();
  }

  finalize(params?: object): Promise<ClerkFlowResult> {
    this.state.record("signIn.finalize", [params]);
    return ok();
  }

  password(params: object): Promise<ClerkFlowResult> {
    this.state.record("signIn.password", [params]);
    if (this.passwordFailure !== undefined) {
      this.state.signInErrors.set({
        fields: { password: { message: this.passwordFailure.message } },
        raw: [{ code: "form_password_incorrect" }],
        global: null,
      });
      this.state.notify();
      return Promise.resolve({ error: { message: this.passwordFailure.message } });
    }
    return ok();
  }
}

/** A fake of clerk-js's future sign-up resource, with the same reset and sso behavior as the sign-in fake. */
export class FakeSignUpFuture {
  readonly statusCell: Cell<string>;
  emailAddress: string | null = null;
  /** The session the completed sign-up created, or `null` (set by a scripted flow). */
  createdSessionId: string | null = null;
  readonly verifications = {
    emailAddress: { status: null as string | null },
    phoneNumber: { status: null as string | null },
    web3Wallet: { status: null as string | null },
    externalAccount: { status: null as string | null },
    emailLinkVerification: null,
    sendEmailCode: (): Promise<ClerkFlowResult> => ok(),
    verifyEmailCode: (): Promise<ClerkFlowResult> => ok(),
  };

  private readonly state: FakeInternalState;

  constructor(state: FakeInternalState, status: string) {
    this.state = state;
    this.statusCell = new Cell(status);
  }

  get status(): string {
    return this.statusCell.get();
  }

  setStatus(status: string): void {
    this.statusCell.set(status);
    this.state.notify();
  }

  reset(): Promise<ClerkFlowResult> {
    this.state.record("signUp.reset", []);
    this.emailAddress = null;
    this.setStatus("missing_requirements");
    return ok();
  }

  sso(params: object): Promise<ClerkFlowResult> {
    this.state.record("signUp.sso", [params]);
    return ok();
  }

  create(params: object): Promise<ClerkFlowResult> {
    this.state.record("signUp.create", [params]);
    return ok();
  }

  update(params: object): Promise<ClerkFlowResult> {
    this.state.record("signUp.update", [params]);
    return ok();
  }

  password(params: object): Promise<ClerkFlowResult> {
    this.state.record("signUp.password", [params]);
    return ok();
  }

  finalize(params?: object): Promise<ClerkFlowResult> {
    this.state.record("signUp.finalize", [params]);
    return ok();
  }
}

/**
 * clerk-js's `__internal_state` in miniature: the sign-in and sign-up resources, their errors and fetch status, the
 * computed `signInSignal` and `signUpSignal`, and `__internal_effect`. Each subscription and each dispose is recorded
 * as a call (`__internal_effect`, `effect.dispose`), so a test can count them.
 */
export class FakeInternalState {
  readonly signInResource: Cell<FakeSignInFuture | null> = new Cell<FakeSignInFuture | null>(null);
  readonly signInErrors: Cell<ClerkFlowErrors> = new Cell<ClerkFlowErrors>(NO_ERRORS);
  readonly signInFetch: Cell<ClerkFetchStatus> = new Cell<ClerkFetchStatus>("idle");
  readonly signUpResource: Cell<FakeSignUpFuture | null> = new Cell<FakeSignUpFuture | null>(null);
  readonly signUpErrors: Cell<ClerkFlowErrors> = new Cell<ClerkFlowErrors>(NO_ERRORS);
  readonly signUpFetch: Cell<ClerkFetchStatus> = new Cell<ClerkFetchStatus>("idle");
  /** Bumped by {@link FakeInternalState.notify}: a change inside a resource that the signals must report. */
  private readonly revision = new Cell(0);

  /** The computed `signInSignal`: `{ errors, fetchStatus, signIn }`, a new object after each change. */
  readonly signInSignal: () => unknown = derived<unknown>(() => {
    this.revision.get();
    return {
      errors: this.signInErrors.get(),
      fetchStatus: this.signInFetch.get(),
      signIn: this.signInResource.get(),
    };
  });

  /** The computed `signUpSignal`, as {@link FakeInternalState.signInSignal}. */
  readonly signUpSignal: () => unknown = derived<unknown>(() => {
    this.revision.get();
    return {
      errors: this.signUpErrors.get(),
      fetchStatus: this.signUpFetch.get(),
      signUp: this.signUpResource.get(),
    };
  });

  readonly record: (method: string, args: readonly unknown[]) => void;

  constructor(record: (method: string, args: readonly unknown[]) => void) {
    this.record = record;
  }

  /** Tells the signals that a resource changed its own state. */
  notify(): void {
    this.revision.set(this.revision.get() + 1);
  }

  /** The effect of clerk-js: runs `callback` now and after each change it reads; the returned function disposes it. */
  __internal_effect = (callback: () => void): (() => void) => {
    this.record("__internal_effect", []);
    const effect = new Effect(callback);
    effect.run();
    return () => {
      this.record("effect.dispose", []);
      effect.dispose();
    };
  };

  /** Creates the resources a loaded clerk-js has: an empty sign-in and sign-up. */
  startFutures(): void {
    this.signInResource.set(new FakeSignInFuture(this, "needs_identifier"));
    this.signUpResource.set(new FakeSignUpFuture(this, "missing_requirements"));
  }
}

/**
 * A hand-written Clerk. It implements {@link ClerkLike} structurally, keeps every call in `calls`,
 * and lets a test drive state changes with `emit`. No network, no timers.
 */
export class FakeClerk implements ClerkLike {
  loaded = false;
  client: ClerkClientLike | undefined = undefined;
  user: ClerkUserLike | null | undefined = undefined;
  session: FakeSession | null | undefined = undefined;
  organization: ClerkOrganizationLike | null | undefined = undefined;
  /** Failure returned by `load()`, or `undefined` for a successful load. */
  loadFailure: { readonly error: unknown } | undefined = undefined;
  /** Failure returned by `signOut()`. */
  signOutFailure: { readonly error: unknown } | undefined = undefined;
  /** Failure returned by `redirectToSignIn()`. */
  redirectFailure: { readonly error: unknown } | undefined = undefined;
  /** Failure returned by `setActive()`, for tests of a rejected activation. */
  setActiveFailure: { readonly error: unknown } | undefined = undefined;
  readonly calls: FakeCall[] = [];
  /**
   * clerk-js's `__internal_state`. Present by default (a clerk-js with the future API). Removed by
   * {@link FakeClerk.withoutInternalState} for an older clerk-js.
   */
  __internal_state: FakeInternalState | undefined = new FakeInternalState((method, args) => {
    this.calls.push({ method, args });
  });
  readonly listeners: Set<ClerkListener> = new Set<ClerkListener>();
  /** Options passed to `addListener`, in order. */
  readonly listenerOptions: unknown[] = [];

  /** Every recorded call with the given method name. */
  callsTo(method: string): FakeCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  /** Number of times the method was called. */
  count(method: string): number {
    return this.callsTo(method).length;
  }

  /** How the verification dialog ends: `"verified"` or `"canceled"`. */
  reverificationOutcome: "verified" | "canceled" = "verified";
  /** `clerk.__internal_openReverification`: records the request and ends the dialog as `reverificationOutcome` says. */
  __internal_openReverification = (props: ClerkReverificationProps): void => {
    this.calls.push({ method: "__internal_openReverification", args: [props] });
    if (this.reverificationOutcome === "verified") props.afterVerification();
    else props.afterVerificationCancelled();
  };

  /** `clerk.__internal_reloadInitialResources`: records the call; `reloadEffect` runs first when set. */
  reloadEffect: (() => void) | undefined = undefined;
  __internal_reloadInitialResources = (): Promise<void> => {
    this.calls.push({ method: "__internal_reloadInitialResources", args: [] });
    this.reloadEffect?.();
    return Promise.resolve();
  };

  /** Current resources, as Clerk would emit them. */
  snapshot(): ClerkResourcesLike {
    return {
      client: this.client,
      user: this.user,
      session: this.session,
      organization: this.organization,
    };
  }

  /** Notifies every listener with the current resources. */
  emit(): void {
    const resources = this.snapshot();
    for (const listener of [...this.listeners]) listener(resources);
  }

  /** Replaces the resources and emits once, as one Clerk event. */
  set(next: {
    user?: ClerkUserLike | null | undefined;
    session?: FakeSession | null | undefined;
    organization?: ClerkOrganizationLike | null | undefined;
  }): void {
    if ("user" in next) this.user = next.user;
    if ("session" in next) this.session = next.session;
    if ("organization" in next) this.organization = next.organization;
    this.emit();
  }

  /** Removes `__internal_state`, as an older clerk-js has no such member. */
  withoutInternalState(): this {
    this.__internal_state = undefined;
    return this;
  }

  /** The sign-in resource clerk-js currently holds, or `null`. */
  futureSignIn(): FakeSignInFuture | null {
    return this.__internal_state?.signInResource.get() ?? null;
  }

  /** The sign-up resource clerk-js currently holds, or `null`. */
  futureSignUp(): FakeSignUpFuture | null {
    return this.__internal_state?.signUpResource.get() ?? null;
  }

  /** A sign-in resource bound to this clerk's state, for a test that replaces the current one. */
  newFutureSignIn(status: string): FakeSignInFuture {
    if (this.__internal_state === undefined) throw new Error("this fake has no clerk-js state");
    return new FakeSignInFuture(this.__internal_state, status);
  }

  /** Replaces the sign-in resource (`null` for none) and notifies the state. */
  setFutureSignIn(resource: FakeSignInFuture | null): void {
    this.__internal_state?.signInResource.set(resource);
  }

  /** Sets the sign-in errors and fetch status, as clerk-js does during a request. */
  setSignInFetch(errors: ClerkFlowErrors, fetchStatus: ClerkFetchStatus): void {
    this.__internal_state?.signInErrors.set(errors);
    this.__internal_state?.signInFetch.set(fetchStatus);
  }

  async load(options?: object): Promise<void> {
    this.calls.push({ method: "load", args: [options] });
    await Promise.resolve();
    if (this.loadFailure !== undefined) throw this.loadFailure.error;
    this.loaded = true;
    this.__internal_state?.startFutures();
    this.client = { signIn: { status: null }, signUp: { status: null } };
    // Like the real SDK, a loaded instance with no visitor reports null for each resource.
    this.user ??= null;
    this.session ??= null;
    this.organization ??= null;
    this.emit();
  }

  addListener(listener: ClerkListener, options?: { skipInitialEmit?: boolean }): () => void {
    this.calls.push({ method: "addListener", args: [options] });
    this.listenerOptions.push(options);
    this.listeners.add(listener);
    if (options?.skipInitialEmit !== true) listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async signOut(options?: object): Promise<void> {
    this.calls.push({ method: "signOut", args: [options] });
    if (this.signOutFailure !== undefined) throw this.signOutFailure.error;
    await Promise.resolve();
    this.session = null;
    this.user = null;
    this.organization = null;
    this.emit();
  }

  openSignIn(options?: object): void {
    this.calls.push({ method: "openSignIn", args: [options] });
  }

  openSignUp(options?: object): void {
    this.calls.push({ method: "openSignUp", args: [options] });
  }

  async redirectToSignIn(options?: object): Promise<unknown> {
    this.calls.push({ method: "redirectToSignIn", args: [options] });
    await Promise.resolve();
    if (this.redirectFailure !== undefined) throw this.redirectFailure.error;
    return undefined;
  }

  async redirectToSignUp(options?: object): Promise<unknown> {
    this.calls.push({ method: "redirectToSignUp", args: [options] });
    return undefined;
  }

  async setActive(params: {
    session?: string | null;
    organization?: string | null;
  }): Promise<void> {
    this.calls.push({ method: "setActive", args: [params] });
    await Promise.resolve();
    if (this.setActiveFailure !== undefined) throw this.setActiveFailure.error;
  }

  mountSignIn(node: HTMLDivElement, options?: object): void {
    this.calls.push({ method: "mountSignIn", args: [options], node });
  }

  unmountSignIn(node: HTMLDivElement): void {
    this.calls.push({ method: "unmountSignIn", args: [], node });
  }

  mountSignUp(node: HTMLDivElement, options?: object): void {
    this.calls.push({ method: "mountSignUp", args: [options], node });
  }

  unmountSignUp(node: HTMLDivElement): void {
    this.calls.push({ method: "unmountSignUp", args: [], node });
  }

  mountUserButton(node: HTMLDivElement, options?: object): void {
    this.calls.push({ method: "mountUserButton", args: [options], node });
  }

  unmountUserButton(node: HTMLDivElement): void {
    this.calls.push({ method: "unmountUserButton", args: [], node });
  }

  mountUserProfile(node: HTMLDivElement, options?: object): void {
    this.calls.push({ method: "mountUserProfile", args: [options], node });
  }

  unmountUserProfile(node: HTMLDivElement): void {
    this.calls.push({ method: "unmountUserProfile", args: [], node });
  }

  mountOrganizationSwitcher(node: HTMLDivElement, options?: object): void {
    this.calls.push({ method: "mountOrganizationSwitcher", args: [options], node });
  }

  unmountOrganizationSwitcher(node: HTMLDivElement): void {
    this.calls.push({ method: "unmountOrganizationSwitcher", args: [], node });
  }

  mountOrganizationProfile(node: HTMLDivElement, options?: object): void {
    this.calls.push({ method: "mountOrganizationProfile", args: [options], node });
  }

  unmountOrganizationProfile(node: HTMLDivElement): void {
    this.calls.push({ method: "unmountOrganizationProfile", args: [], node });
  }

  mountCreateOrganization(node: HTMLDivElement, options?: object): void {
    this.calls.push({ method: "mountCreateOrganization", args: [options], node });
  }

  unmountCreateOrganization(node: HTMLDivElement): void {
    this.calls.push({ method: "unmountCreateOrganization", args: [], node });
  }

  mountOrganizationList(node: HTMLDivElement, options?: object): void {
    this.calls.push({ method: "mountOrganizationList", args: [options], node });
  }

  unmountOrganizationList(node: HTMLDivElement): void {
    this.calls.push({ method: "unmountOrganizationList", args: [], node });
  }

  mountWaitlist(node: HTMLDivElement, options?: object): void {
    this.calls.push({ method: "mountWaitlist", args: [options], node });
  }

  unmountWaitlist(node: HTMLDivElement): void {
    this.calls.push({ method: "unmountWaitlist", args: [], node });
  }

  mountPricingTable(node: HTMLDivElement, options?: object): void {
    this.calls.push({ method: "mountPricingTable", args: [options], node });
  }

  unmountPricingTable(node: HTMLDivElement): void {
    this.calls.push({ method: "unmountPricingTable", args: [], node });
  }

  async handleRedirectCallback(params?: object): Promise<unknown> {
    this.calls.push({ method: "handleRedirectCallback", args: [params] });
    return undefined;
  }
}

/** A user with the given organization memberships. */
export function fakeUser(
  id = "user_1",
  memberships: readonly ClerkMembershipLike[] = [],
): ClerkUserLike {
  return { id, organizationMemberships: memberships };
}

/** A membership of `user` in organization `orgId`. */
export function fakeMembership(
  orgId: string,
  role: string,
  permissions: readonly string[] = [],
): ClerkMembershipLike {
  return { role, permissions, organization: { id: orgId } };
}

/** An organization with the given id. */
export function fakeOrg(id = "org_1"): ClerkOrganizationLike {
  return { id };
}
