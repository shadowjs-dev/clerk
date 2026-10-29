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

/**
 * The name of the cross-tab channel of one publishable key: a short stable hash (cyrb53) of the whole key. The end of
 * the key is not enough: two instances of one app can share their last characters, and their tabs would then wake
 * each other. The key itself is not written into the name.
 * @internal
 */
export function syncChannelName(key: string): string {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second =
    Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return (first >>> 0).toString(36) + (second >>> 0).toString(36);
}
