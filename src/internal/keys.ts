/**
 * Clerk publishable keys are `pk_test_` or `pk_live_` followed by base64 text. Anything else is a
 * configuration mistake, so it is rejected before any SDK is loaded.
 */
const PUBLISHABLE_KEY = /^pk_(test|live)_[A-Za-z0-9+/_=-]+$/;

/**
 * Returns the key when it has the shape of a Clerk publishable key. The error never echoes the
 * value, so a mistyped secret cannot end up in logs through this path.
 * @internal
 */
export function checkPublishableKey(key: unknown): string {
  if (typeof key !== "string" || !PUBLISHABLE_KEY.test(key)) {
    throw new TypeError(
      "ClerkProvider: publishableKey must be a Clerk publishable key (pk_test_... or pk_live_...).",
    );
  }
  return key;
}
