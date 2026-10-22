/**
 * What is checked before `@clerk/backend` sees a request: how much token text it has to decode, and how many
 * times a request can make it fetch Clerk's signing keys.
 *
 * `@clerk/backend` verifies a token against the key whose `kid` the token names, and fetches the key set from
 * the Backend API when the `kid` is not in its cache. The `kid` is attacker-chosen and the check runs before the
 * signature is known, so a stream of requests with fresh random `kid`s makes the server call Clerk once per
 * request, with the secret key, until Clerk's rate limit answers the real traffic too. Setting `jwtKey` removes
 * the fetch. Without it, this module lets a few unknown `kid`s through per minute (a key rotation needs one) and
 * answers the rest as signed out without calling Clerk.
 * @packageDocumentation
 */

/** The longest token read, in characters. Session tokens fit in a 4 KiB cookie; this is four times that. */
export const MAX_TOKEN_LENGTH: number = 16 * 1024;
/** The longest `Cookie` header read, in characters. Servers refuse far less (8 to 32 KiB). */
export const MAX_COOKIE_HEADER_LENGTH: number = 64 * 1024;
/** How many distinct unknown key ids one instance may look up in one window. */
export const UNKNOWN_KID_BUDGET: number = 4;
/** The window of the budget, in milliseconds. */
export const WINDOW_MS: number = 60_000;
/**
 * How long a key id that Clerk's key set did not have stays refused, in milliseconds. Short, because a token signed
 * just after a rotation may reach a server whose first look at the key set was a moment too early.
 */
export const REFUSAL_MS: number = 10_000;

const MAX_KID_LENGTH = 128;
const MAX_KNOWN_KIDS = 16;
const MAX_REFUSED_KIDS = 64;
const MAX_INSTANCES = 8;

/** The key ids seen for one instance, and the lookups it spent. All of it is bounded. */
interface Instance {
  /** Key ids that verified a signature: Clerk's JWKS has them. */
  readonly known: Set<string>;
  /** Key ids Clerk's JWKS did not have, with the time the refusal ends. */
  readonly refused: Map<string, number>;
  /** The unknown key ids that spent a lookup in this window. */
  readonly spent: Set<string>;
  windowStart: number;
}

const instances = new Map<string, Instance>();

function instanceOf(scope: string, now: number): Instance {
  let found = instances.get(scope);
  if (found === undefined) {
    if (instances.size >= MAX_INSTANCES) {
      const oldest = instances.keys().next().value;
      if (oldest !== undefined) instances.delete(oldest);
    }
    found = { known: new Set(), refused: new Map(), spent: new Set(), windowStart: now };
    instances.set(scope, found);
  }
  if (now - found.windowStart >= WINDOW_MS) {
    found.spent.clear();
    found.windowStart = now;
  }
  return found;
}

/** The sizes of the guard's tables, for the test that hits their bounds. @internal */
export function guardSizes(): { instances: number; known: number; refused: number } {
  let known = 0;
  let refused = 0;
  for (const instance of instances.values()) {
    known = Math.max(known, instance.known.size);
    refused = Math.max(refused, instance.refused.size);
  }
  return { instances: instances.size, known, refused };
}

/** Forgets everything the guard has seen. @internal */
export function resetGuard(): void {
  instances.clear();
}

/** The token text a request offers: the bearer token, the session cookies and the handshake token. */
function tokensOf(request: Request, url: URL): string[] {
  const out: string[] = [];
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const [scheme, token] = authorization.split(" ", 2);
    if (scheme !== undefined) {
      if (token === undefined) out.push(scheme);
      else if (scheme === "Bearer") out.push(token);
    }
  }
  const cookies = request.headers.get("cookie");
  if (cookies !== null) {
    for (const pair of cookies.split(";")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      if (name === "__session" || name.startsWith("__session_") || name === "__clerk_handshake") {
        out.push(pair.slice(eq + 1).trim());
      }
    }
  }
  const handshake = url.searchParams.get("__clerk_handshake");
  if (handshake !== null) out.push(handshake);
  return out;
}

/**
 * The key id a token names (`""` when it names none), or `undefined` when the token has no JSON header. Only the
 * header is read, and only when it is short.
 */
function kidOf(token: string): string | undefined {
  const header = token.slice(0, token.indexOf("."));
  if (header.length === 0 || header.length > 2048) return undefined;
  try {
    const standard = header.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(
      atob(standard + "=".repeat((4 - (standard.length % 4)) % 4)),
    );
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const kid: unknown = Reflect.get(parsed, "kid");
    return typeof kid === "string" ? kid.slice(0, MAX_KID_LENGTH) : "";
  } catch (error) {
    // A header that is not base64 or not JSON is the normal shape of a forged token: the backend refuses it
    // without looking for a key, so it takes no lookup.
    if (error instanceof SyntaxError || error instanceof DOMException) return undefined;
    throw error;
  }
}

/** The answer to a request before the backend runs: let it through, or the reason it is refused. */
export interface Admission {
  /** Non-null when the request is answered as signed out without calling the backend. */
  readonly reason: string | null;
  /**
   * Reports the outcome, so the guard learns which key ids Clerk knows. `token` is the token that signed the
   * request in, when one did.
   */
  readonly done: (signedIn: boolean, reason: string | null, token: string | null) => void;
}

const NOTHING: Admission["done"] = () => undefined;

/**
 * Decides whether the backend may run for this request.
 *
 * @param request The incoming request.
 * @param scope What the key set belongs to (the publishable key).
 * @param remoteKeys True when the keys come from Clerk's API (no `jwtKey`), the only case that costs a fetch.
 * @returns An {@link Admission}.
 * @internal
 */
export function admit(request: Request, scope: string, remoteKeys: boolean): Admission {
  const cookies = request.headers.get("cookie");
  if (cookies !== null && cookies.length > MAX_COOKIE_HEADER_LENGTH) {
    return { reason: "token-too-large", done: NOTHING };
  }
  const url = new URL(request.url);
  const tokens = tokensOf(request, url);
  if (tokens.some((token) => token.length > MAX_TOKEN_LENGTH)) {
    return { reason: "token-too-large", done: NOTHING };
  }
  if (!remoteKeys) return { reason: null, done: NOTHING };
  const kids: string[] = [];
  for (const token of tokens) {
    const kid = kidOf(token);
    if (kid !== undefined && !kids.includes(kid)) kids.push(kid);
  }
  if (kids.length === 0) return { reason: null, done: NOTHING };
  const now = Date.now();
  const instance = instanceOf(scope, now);
  const unknown = kids.filter((kid) => !instance.known.has(kid));
  if (unknown.length === 0) return { reason: null, done: NOTHING };
  for (const kid of unknown) {
    const until = instance.refused.get(kid);
    if (until !== undefined && until > now) return { reason: "jwks-lookup-refused", done: NOTHING };
  }
  const fresh = unknown.filter((kid) => !instance.spent.has(kid));
  if (instance.spent.size + fresh.length > UNKNOWN_KID_BUDGET) {
    return { reason: "jwks-lookup-refused", done: NOTHING };
  }
  for (const kid of fresh) instance.spent.add(kid);
  return {
    reason: null,
    done: (signedIn, reason, token) => {
      if (signedIn) {
        // Only a verified signature proves Clerk has the key, and only for the token that was verified: a
        // request may carry other tokens (a cookie next to a bearer) that name any key id they like.
        const kid = token === null ? undefined : kidOf(token);
        if (kid !== undefined && unknown.includes(kid)) {
          if (instance.known.size >= MAX_KNOWN_KIDS) {
            const oldest = instance.known.values().next().value;
            if (oldest !== undefined) instance.known.delete(oldest);
          }
          instance.known.add(kid);
          instance.refused.delete(kid);
        }
        return;
      }
      // With several candidates the backend does not say which one Clerk did not know; refuse none then.
      const [only] = unknown;
      if (reason === "jwk-kid-mismatch" && unknown.length === 1 && only !== undefined) {
        if (instance.refused.size >= MAX_REFUSED_KIDS) {
          const oldest = instance.refused.keys().next().value;
          if (oldest !== undefined) instance.refused.delete(oldest);
        }
        instance.refused.set(only, Date.now() + REFUSAL_MS);
      }
    },
  };
}
