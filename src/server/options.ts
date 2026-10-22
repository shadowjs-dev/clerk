/**
 * Options of the server helpers ({@link authenticateRequest}, {@link requireAuth}, {@link clerkMiddleware}). Every key
 * is read from the server environment by the application; the package never reads `process.env` itself. They are
 * checked each time a helper is called (and once when `clerkMiddleware` is created); a missing or malformed value
 * throws a `TypeError` that names the setting and never prints the value.
 * @since 1.0.0
 */
export interface ClerkServerOptions {
  /** Clerk secret key (`sk_test_...` or `sk_live_...`). Required. Never sent to the browser, logged or returned. */
  readonly secretKey: string;
  /** Clerk publishable key (`pk_test_...` or `pk_live_...`). Required. */
  readonly publishableKey: string;
  /**
   * Origins allowed to present the token, matched against its `azp` claim. Required for a production
   * instance (an `sk_live_` key): without it a token minted for another application on the same Clerk
   * instance would sign a user in. `false` is the explicit opt-out and accepts any `azp`. A development
   * instance (`sk_test_`) that leaves it unset gets one warning. An empty list is refused (the backend skips the
   * check for it). A handshake may return only to a listed origin.
   */
  readonly authorizedParties?: readonly string[] | false;
  /**
   * The PEM public key of the instance (`-----BEGIN PUBLIC KEY-----` ... `-----END PUBLIC KEY-----`, RSA form
   * accepted). With it, tokens are verified locally and no request goes to Clerk's API for keys. Without it four
   * unknown key ids per minute per instance are looked up, and the rest are answered as signed out
   * (`jwks-lookup-refused`). Anything that is not a PEM public key throws a `TypeError`.
   */
  readonly jwtKey?: string;
}

/** Publishable keys already warned about. Bounded: a process has a handful of instances. */
const warnedKeys = new Set<string>();
const WARNED_KEYS_LIMIT = 32;

/** Writes `message` once per publishable key; the key is never part of the message. @internal */
function warnOnce(publishableKey: string, message: string): void {
  if (!warnedKeys.has(publishableKey)) {
    if (warnedKeys.size < WARNED_KEYS_LIMIT) warnedKeys.add(publishableKey);
    console.warn(message);
  }
}

const SECRET_KEY = /^sk_(test|live)_\S+$/;
const PUBLISHABLE_KEY = /^pk_(test|live)_[A-Za-z0-9+/_=-]+$/;
const PEM_PUBLIC_KEY = /-----BEGIN (RSA )?PUBLIC KEY-----[\s\S]+-----END (RSA )?PUBLIC KEY-----/;

/**
 * Validates the options once, so a missing or malformed key fails at startup with a message that
 * names the setting and never echoes a value.
 * @internal
 */
export function checkServerOptions(options: ClerkServerOptions): ClerkServerOptions {
  const { secretKey, publishableKey, authorizedParties, jwtKey } = options;
  if (typeof secretKey !== "string" || secretKey.length === 0) {
    throw new TypeError(
      "clerk: secretKey is required. Set the Clerk secret key (sk_test_... or sk_live_...).",
    );
  }
  if (!SECRET_KEY.test(secretKey)) {
    throw new TypeError("clerk: secretKey must start with sk_test_ or sk_live_.");
  }
  if (typeof publishableKey !== "string" || publishableKey.length === 0) {
    throw new TypeError(
      "clerk: publishableKey is required. Set the Clerk publishable key (pk_test_... or pk_live_...).",
    );
  }
  if (!PUBLISHABLE_KEY.test(publishableKey)) {
    throw new TypeError("clerk: publishableKey must start with pk_test_ or pk_live_.");
  }
  const checked: {
    secretKey: string;
    publishableKey: string;
    authorizedParties?: string[] | false;
    jwtKey?: string;
  } = {
    secretKey,
    publishableKey,
  };
  if (authorizedParties === undefined) {
    if (secretKey.startsWith("sk_live_")) {
      throw new TypeError(
        "clerk: authorizedParties is required for a production instance (an sk_live_ key). List the origins that may present tokens, or pass authorizedParties: false to accept a token minted for any application on this Clerk instance (unsafe).",
      );
    }
    warnOnce(
      publishableKey,
      "clerk: authorizedParties is not set, so a token minted for another application on this Clerk instance is accepted. List the origins that may present tokens; a production instance (sk_live_) refuses this setting.",
    );
  } else if (authorizedParties === false) {
    checked.authorizedParties = false;
  } else {
    // An empty list is refused, not read as "no list": @clerk/backend skips the azp check for it, so it would
    // pass the production rule above and accept a token minted for any application of the instance.
    if (
      !Array.isArray(authorizedParties) ||
      authorizedParties.length === 0 ||
      authorizedParties.some((item) => typeof item !== "string" || item.length === 0)
    ) {
      throw new TypeError(
        "clerk: authorizedParties must be a list of non-empty origins (at least one), or false to opt out.",
      );
    }
    checked.authorizedParties = [...authorizedParties];
  }
  if (jwtKey !== undefined) {
    if (typeof jwtKey !== "string" || !PEM_PUBLIC_KEY.test(jwtKey)) {
      throw new TypeError("clerk: jwtKey must be the PEM public key of the Clerk instance.");
    }
    checked.jwtKey = jwtKey;
  }
  return checked;
}

/**
 * Whether a redirect target has a control character, whitespace or a backslash. Browsers drop tabs and newlines
 * inside a URL and read `\` as `/`, so `"/\t/evil.example"` and `"/\\evil.example"` are `//evil.example` to them.
 * @internal
 */
export function hasUnsafeTargetChar(url: string): boolean {
  for (const ch of url) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || ch === "\\") return true;
  }
  return false;
}

/**
 * Checks a same-app redirect target (`/sign-in`, `/sign-in?lang=ar`): it starts with one `/`, is not
 * protocol-relative, and has no character a browser would read differently from this check (a tab or newline
 * is removed by the URL parser, so `"/\t/evil.example"` would become `//evil.example`).
 * @internal
 */
export function checkedAppPath(url: string, setting: string): string {
  if (
    typeof url !== "string" ||
    !url.startsWith("/") ||
    url.startsWith("//") ||
    hasUnsafeTargetChar(url)
  ) {
    throw new TypeError(`clerk: ${setting} must be a same-app path such as /sign-in.`);
  }
  return url;
}
