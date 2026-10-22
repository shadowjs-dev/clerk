import {
  createHmac,
  createPrivateKey,
  createSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";

/**
 * Helpers of the PASS 2 security tests (`security2-*.server.test.ts`). Every key is generated here with
 * `node:crypto`; nothing in this file is a real Clerk secret and nothing reaches the network.
 */

/** The frontend API host the publishable key names, and the issuer of the tokens. */
export const FRONTEND_API = "clerk.example.com";
export const ISSUER: string = `https://${FRONTEND_API}`;
/** The origin of the application under test. */
export const APP = "https://app.example.com";

/** A publishable key (`pk_live_`/`pk_test_`) that names `host` as its frontend API. */
export function publishableKeyFor(host: string, env: "live" | "test" = "live"): string {
  return `pk_${env}_${Buffer.from(`${host}$`).toString("base64")}`;
}

export const LIVE_PUBLISHABLE_KEY: string = publishableKeyFor(FRONTEND_API);
export const DEV_PUBLISHABLE_KEY: string = publishableKeyFor(
  "bright-otter-42.clerk.accounts.dev",
  "test",
);
export const LIVE_SECRET_KEY = "sk_live_sec2_test_secret_value_do_not_log";
export const DEV_SECRET_KEY = "sk_test_sec2_test_secret_value_do_not_log";

/** A throwaway RSA key pair. */
export interface TestKeys {
  readonly privateKey: KeyObject;
  readonly publicPem: string;
  /** The public key as a JWK with a `kid`, the shape Clerk's JWKS endpoint returns. */
  readonly jwk: Record<string, unknown>;
}

export function makeKeys(kid = "ins_test", bits = 2048): TestKeys {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: bits,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const privateKey = createPrivateKey(pair.privateKey);
  const exported = createPrivateKey(pair.privateKey).export({ format: "jwk" });
  const jwk: Record<string, unknown> = {
    kty: "RSA",
    n: exported.n,
    e: exported.e,
    kid,
    alg: "RS256",
    use: "sig",
  };
  return { privateKey, publicPem: pair.publicKey, jwk };
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** base64url of a string or a JSON value. */
export function b64u(value: string | object): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(text).toString("base64url");
}

/** Signs `header.payload` with RSASSA-PKCS1-v1_5 and the hash `hash` (`RSA-SHA256` ...). */
export function signParts(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: KeyObject,
  hash = "RSA-SHA256",
): string {
  const data = `${b64u(header)}.${b64u(payload)}`;
  const signer = createSign(hash);
  signer.update(data);
  signer.end();
  return `${data}.${signer.sign(key).toString("base64url")}`;
}

/** A current v2 session token for `APP`. `claims` replace the defaults; `header` replaces the header. */
export function sessionToken(
  keys: TestKeys,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): string {
  return signParts(
    { alg: "RS256", typ: "JWT", kid: "ins_test", ...header },
    {
      v: 2,
      azp: APP,
      sub: "user_123",
      sid: "sess_123",
      iss: ISSUER,
      nbf: nowSeconds() - 10,
      iat: nowSeconds(),
      exp: nowSeconds() + 60,
      ...claims,
    },
    keys.privateKey,
  );
}

/** A JWT signed with HMAC-SHA256, the key being `secret` (the algorithm-confusion attack). */
export function hmacToken(secret: string | Buffer, claims: Record<string, unknown>): string {
  const data = `${b64u({ alg: "HS256", typ: "JWT", kid: "ins_test" })}.${b64u(claims)}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}

/** The claims of a valid session token, for tests that build a token by hand. */
export function validClaims(): Record<string, unknown> {
  return {
    v: 2,
    azp: APP,
    sub: "user_123",
    sid: "sess_123",
    iss: ISSUER,
    nbf: nowSeconds() - 10,
    iat: nowSeconds(),
    exp: nowSeconds() + 60,
  };
}

/** A request that presents `token` in the Authorization header. */
export function bearer(token: string, url = `${APP}/api`): Request {
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

/** A document request (what a browser sends for a page) with the given cookies. */
export function page(
  path: string,
  cookies: string[] = [],
  extra: Record<string, string> = {},
): Request {
  const headers: Record<string, string> = {
    accept: "text/html",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    ...extra,
  };
  if (cookies.length > 0) headers["cookie"] = cookies.join("; ");
  return new Request(`${APP}${path}`, { headers });
}
