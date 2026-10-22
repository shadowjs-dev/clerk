/**
 * Runs a Clerk call made from an event handler or an effect. A synchronous throw and a rejected
 * promise both go to `fail`, which the provider turns into an error for its ErrorBoundary. Nothing
 * is left as an unhandled rejection, and nothing is swallowed.
 * @internal
 */
export function attempt(action: () => unknown, fail: (error: unknown) => void): void {
  try {
    const result = action();
    if (isPromiseLike(result)) {
      result.then(undefined, (error: unknown) => {
        fail(error);
      });
    }
  } catch (error) {
    fail(error);
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/**
 * Copies the props of a component into a plain options object, without `children` and without the
 * named keys. Reading the props here is what makes a component's effect track them.
 * @internal
 */
export function readOptions(props: object, omit: readonly string[]): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === "children" || omit.includes(key)) continue;
    options[key] = Reflect.get(props, key);
  }
  return options;
}
