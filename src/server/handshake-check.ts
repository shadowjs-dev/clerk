/**
 * The checks on the redirect of a handshake: where it goes, and where it comes back to.
 * @packageDocumentation
 */

/** The shape of a publishable key; the base64 text after the prefix names the frontend API. */
const PUBLISHABLE_KEY = /^pk_(test|live)_[A-Za-z0-9+/_=-]+$/;

/**
 * The origin of the frontend API a publishable key names (`https://clerk.example.com`), or `undefined` when
 * the key does not decode to a host. The handshake redirect of `@clerk/backend` goes to this origin and to no
 * other.
 * @internal
 */
export function frontendOriginOf(publishableKey: string): string | undefined {
  const encoded = PUBLISHABLE_KEY.exec(publishableKey)?.[0].slice("pk_test_".length);
  if (encoded === undefined) return undefined;
  let decoded: string;
  try {
    const standard = encoded.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
    decoded = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
  } catch (error) {
    if (error instanceof DOMException) return undefined;
    throw error;
  }
  const host = decoded.endsWith("$") ? decoded.slice(0, -1) : "";
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host) ? `https://${host.toLowerCase()}` : undefined;
}

/**
 * Whether the redirect `@clerk/backend` asked for may be sent: it goes to the frontend API of the publishable key
 * and to no other host, and, when the application listed its origins, `redirect_url` (where Clerk sends the
 * browser back) is one of them. The backend builds that URL from `X-Forwarded-Host`, which a proxy in front of
 * the application may pass on from the client.
 *
 * @param location The `location` header of the handshake outcome.
 * @param frontendOrigin The origin the publishable key names, or undefined when it names none.
 * @param parties The `authorizedParties` option.
 * @returns True when the redirect may be sent.
 * @internal
 */
export function handshakeTargetAllowed(
  location: string | null,
  frontendOrigin: string | undefined,
  parties: readonly string[] | false | undefined,
): boolean {
  if (location === null || frontendOrigin === undefined) return false;
  try {
    const target = new URL(location);
    if (target.origin !== frontendOrigin) return false;
    if (parties === undefined || parties === false) return true;
    const back = target.searchParams.get("redirect_url");
    return back !== null && parties.includes(new URL(back).origin);
  } catch (error) {
    // `new URL` throws a TypeError for text that is not a URL: such a redirect is refused.
    if (error instanceof TypeError) return false;
    throw error;
  }
}
