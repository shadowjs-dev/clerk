/**
 * A UI constructor that arrives when something asks for it. clerk-js takes `ui.ClerkUI` as a value or a promise and
 * does not wait for the promise to finish `load()`, so the provider hands it `ClerkUI`, which resolves once
 * {@link LazyUi.load} has loaded the bundle. `ClerkUI` never rejects: a failure goes to the caller of `load()`,
 * which may call it again, and a promise clerk-js holds on to would otherwise report an unhandled rejection at every
 * component it opens.
 * @internal
 */
export interface LazyUi {
  /** Handed to `clerk.load({ ui: { ClerkUI } })`. Pending until the bundle has loaded. */
  readonly ClerkUI: Promise<unknown>;
  /** Loads the bundle once at a time, and resolves when it is ready. A failed attempt rejects and the next call retries. */
  load(): Promise<void>;
  /** True once the bundle has loaded. */
  ready(): boolean;
}

/**
 * @param loadConstructor Loads the UI bundle and returns its constructor.
 * @returns The deferred constructor.
 * @internal
 */
export function createLazyUi(loadConstructor: () => Promise<unknown>): LazyUi {
  let resolveConstructor: (value: unknown) => void = () => undefined;
  const ClerkUI = new Promise<unknown>((resolve) => {
    resolveConstructor = resolve;
  });
  let pending: Promise<void> | undefined;
  let done = false;
  return {
    ClerkUI,
    load(): Promise<void> {
      if (done) return Promise.resolve();
      pending ??= loadConstructor().then(
        (value) => {
          done = true;
          resolveConstructor(value);
        },
        (error: unknown) => {
          pending = undefined;
          throw error;
        },
      );
      return pending;
    },
    ready: () => done,
  };
}
