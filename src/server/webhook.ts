/**
 * Verifies a Clerk webhook (Svix signatures) and returns the event. Clerk sends `svix-id`,
 * `svix-timestamp` and `svix-signature` headers; this module checks them with the Web Crypto API, so
 * it runs in Node, Deno, Bun and Workers without a Svix dependency.
 * @packageDocumentation
 */

/**
 * Why a webhook was refused, as {@link WebhookVerificationError.reason}. Logged by the application; it never contains
 * the secret or the body.
 * - `missing-headers`: `svix-id`, `svix-timestamp` or `svix-signature` is missing (or the id or timestamp is empty).
 * - `bad-timestamp`: `svix-timestamp` is not a whole number of seconds.
 * - `timestamp-out-of-tolerance`: the timestamp is further from the clock than `toleranceSeconds`.
 * - `bad-signature`: no `v1` signature matches (or `svix-id` contains a `.`).
 * - `bad-body`: the body is not JSON, or has no string `type`.
 * - `body-too-large`: the body (or its `content-length`) is over `maxBodyBytes`.
 * @since 1.0.0
 */
export type WebhookFailureReason =
  | "missing-headers"
  | "bad-timestamp"
  | "timestamp-out-of-tolerance"
  | "bad-signature"
  | "bad-body"
  | "body-too-large";

/**
 * The error of a webhook that fails verification. Answer the request with `400` or `401`; do not
 * process the event. Its `name` is `"WebhookVerificationError"`, and its message holds neither the secret, the
 * signature nor any part of the body.
 * @example
 * ```ts
 * import { verifyWebhook, WebhookVerificationError } from "@shadow-js/clerk/server";
 *
 * export async function handleClerkWebhook(request: Request, secret: string): Promise<Response> {
 *   try {
 *     await verifyWebhook(request, { secret });
 *     return new Response(null, { status: 204 });
 *   } catch (error) {
 *     if (error instanceof WebhookVerificationError) return new Response(error.reason, { status: 400 });
 *     throw error;
 *   }
 * }
 * ```
 * @since 1.0.0
 */
export class WebhookVerificationError extends Error {
  /** The reason the webhook was refused. See {@link WebhookFailureReason}. */
  readonly reason: WebhookFailureReason;

  /**
   * Creates the error. {@link verifyWebhook} throws it; applications only need it for `instanceof`.
   * @param reason The failed check.
   * @param message A description that holds no secret and no part of the body.
   * @param options `cause`, the underlying error, when there is one.
   */
  constructor(
    reason: WebhookFailureReason,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "WebhookVerificationError";
    this.reason = reason;
  }
}

/**
 * A verified Clerk event. `type` is the event name (for example `user.created`), `data` its
 * resource, as Clerk sends it.
 * @since 1.0.0
 */
export interface WebhookEvent {
  /** The event name, for example `user.created`. Always a string: a body without one is refused. */
  readonly type: string;
  /**
   * The resource of the event, as Clerk sends it. Not checked beyond the signature: parts of it (such as
   * `unsafe_metadata`) are written by users. `__proto__`, and `constructor` keys that hold a `prototype`, are dropped.
   */
  readonly data: Readonly<Record<string, unknown>>;
  /** The `object` field of the payload, when Clerk sends one. */
  readonly object?: string;
}

/**
 * Options of {@link verifyWebhook}.
 * @since 1.0.0
 */
export interface VerifyWebhookOptions {
  /**
   * The signing secret of the endpoint (`whsec_` followed by base64), from the Clerk dashboard. Anything else throws a
   * `TypeError` that does not repeat the value.
   */
  readonly secret: string;
  /**
   * How far the timestamp may be from now, in seconds, either way, boundary included. The Svix default. A value that
   * is not a finite number of at least 0 throws a `TypeError`.
   * @default 300
   */
  readonly toleranceSeconds?: number;
  /**
   * The largest body read, in bytes. The body is read before its signature can be checked, so a request that
   * claims a current timestamp could otherwise make the server buffer any size. Default 1 MiB (Svix payloads are
   * a few kilobytes). A value that is not a finite number above 0 throws a `TypeError`.
   * @default 1048576
   */
  readonly maxBodyBytes?: number;
  /** The clock, in seconds since the epoch. Default: `Math.floor(Date.now() / 1000)`. Tests inject it. */
  readonly now?: () => number;
}

/** Default tolerance between the signed timestamp and the verifier's clock, in seconds. @internal */
const DEFAULT_TOLERANCE_SECONDS = 300;

/** Default largest webhook body, in bytes. @internal */
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * The most `v1` signatures read from the header. Svix sends one per active secret (two while a secret is being
 * rotated); the rest of a longer header is ignored, so a header cannot make the check do more work.
 * @internal
 */
const MAX_SIGNATURES = 16;

/**
 * Reads a request body as bytes, stopping at `limit` bytes. Chunks are read as they come, so a body far larger than
 * the limit is never held in memory. The signature covers these bytes, not a decoded string: decoding drops a
 * byte-order mark and replaces invalid UTF-8, so two different bodies could decode to the same text.
 * @internal
 */
async function readBoundedBytes(request: Request, limit: number): Promise<Uint8Array> {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new WebhookVerificationError(
          "body-too-large",
          "The webhook body is larger than allowed.",
        );
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

/**
 * Decodes base64 to bytes. Returns `undefined` for text that is not base64, so a bad signature
 * entry is skipped rather than failing the whole check.
 * @internal
 */
function decodeBase64(text: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

/**
 * Imports the HMAC key from the `whsec_` secret. The error names the setting, never the value.
 * @internal
 */
async function importKey(secret: string): Promise<CryptoKey> {
  const prefix = "whsec_";
  const encoded =
    typeof secret === "string" && secret.startsWith(prefix) ? secret.slice(prefix.length) : "";
  const bytes = encoded === "" ? undefined : decodeBase64(encoded);
  if (bytes === undefined || bytes.length === 0) {
    throw new TypeError(
      "verifyWebhook: secret must be the endpoint's signing secret (whsec_ followed by base64).",
    );
  }
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/**
 * Reads the `v1` signatures from the `svix-signature` header: a space-separated list of `v1,<base64>`
 * entries. Other versions are ignored, and a signature that is not base64 is skipped.
 * @internal
 */
function signaturesOf(header: string): Uint8Array<ArrayBuffer>[] {
  const out: Uint8Array<ArrayBuffer>[] = [];
  for (const entry of header.split(" ")) {
    if (out.length >= MAX_SIGNATURES) break;
    if (!entry.startsWith("v1,")) continue;
    const bytes = decodeBase64(entry.slice(3));
    if (bytes !== undefined) out.push(bytes);
  }
  return out;
}

/**
 * Compares two byte strings without stopping at the first difference, so the time does not tell how many leading
 * bytes of a guess were right. The lengths are public (a SHA-256 MAC is 32 bytes).
 * @internal
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Parses the body, dropping the keys that turn a later merge into prototype pollution: `__proto__`, and a
 * `constructor` that carries a `prototype`. A user controls parts of an event (`unsafe_metadata` is written by the
 * browser), and Clerk's signature vouches for who sent the event, not for what the user put in it.
 * @internal
 */
function parseEvent(text: string): unknown {
  return JSON.parse(text, function reviver(this: unknown, key: string, value: unknown): unknown {
    if (key === "__proto__") return undefined;
    if (
      key === "constructor" &&
      typeof value === "object" &&
      value !== null &&
      "prototype" in value
    ) {
      return undefined;
    }
    return value;
  });
}

/** A number option that must be finite and not negative (or positive, when `positive`). @internal */
function checkedNumber(name: string, value: number, positive: boolean): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    throw new TypeError(
      `verifyWebhook: ${name} must be a finite ${positive ? "positive" : "non-negative"} number.`,
    );
  }
  return value;
}

/**
 * Checks a webhook request and returns its event. The checks, in order: the three Svix headers are
 * present; the timestamp is a number within the tolerance of the clock; one of the `v1` signatures
 * matches HMAC-SHA256 of `${id}.${timestamp}.${body}`; the body is JSON with a `type`.
 *
 * The expected MAC is computed once over the raw body bytes and compared with every listed signature (at most
 * 16) without stopping at the first difference, so the time a wrong signature takes does not reveal how much of it
 * matched and a long header costs no more MACs. The tolerance stops a captured request from being replayed
 * later; inside the tolerance the same request verifies again, so deduplicate events by `svix-id`.
 *
 * @param request The incoming request. Its body is read here, once, so do not read it before.
 * @param options The secret, and optionally the tolerance, the body limit and the clock. See
 *   {@link VerifyWebhookOptions}.
 * @returns The verified event.
 * @throws WebhookVerificationError when the request fails a check (see `reason` and {@link WebhookFailureReason}).
 * @throws TypeError when the secret, `toleranceSeconds` or `maxBodyBytes` is malformed (a configuration error).
 * @example
 * ```ts
 * import { verifyWebhook, WebhookVerificationError } from "@shadow-js/clerk/server";
 *
 * export async function POST(request: Request): Promise<Response> {
 *   try {
 *     const event = await verifyWebhook(request, { secret: process.env["CLERK_WEBHOOK_SECRET"] ?? "" });
 *     if (event.type === "user.created") console.info("new user", event.data["id"]);
 *     return new Response(null, { status: 204 });
 *   } catch (error) {
 *     if (error instanceof WebhookVerificationError) return new Response(error.reason, { status: 400 });
 *     throw error;
 *   }
 * }
 * ```
 * @since 1.0.0
 */
export async function verifyWebhook(
  request: Request,
  options: VerifyWebhookOptions,
): Promise<WebhookEvent> {
  const key = await importKey(options.secret);
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (id === null || timestamp === null || signature === null || id === "" || timestamp === "") {
    throw new WebhookVerificationError(
      "missing-headers",
      "The webhook is missing its svix-id, svix-timestamp or svix-signature header.",
    );
  }
  if (id.includes(".")) {
    // The signed text is `${id}.${timestamp}.${body}`: a dot in the id would move the boundary between fields.
    throw new WebhookVerificationError("bad-signature", "The webhook signature does not match.");
  }
  if (!/^\d+$/.test(timestamp)) {
    throw new WebhookVerificationError(
      "bad-timestamp",
      "The svix-timestamp header is not a number of seconds.",
    );
  }
  // NaN and Infinity would turn every comparison below into "in tolerance" and switch replay protection off.
  const tolerance = checkedNumber(
    "toleranceSeconds",
    options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS,
    false,
  );
  const limit = checkedNumber("maxBodyBytes", options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES, true);
  const now = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  if (Math.abs(now - Number(timestamp)) > tolerance) {
    throw new WebhookVerificationError(
      "timestamp-out-of-tolerance",
      "The webhook timestamp is outside the allowed tolerance.",
    );
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) {
    throw new WebhookVerificationError(
      "body-too-large",
      "The webhook body is larger than allowed.",
    );
  }
  const bytes = await readBoundedBytes(request, limit);
  const prefix = new TextEncoder().encode(`${id}.${timestamp}.`);
  const signed = new Uint8Array(prefix.length + bytes.length);
  signed.set(prefix, 0);
  signed.set(bytes, prefix.length);
  // One MAC however many signatures the header lists; every candidate is compared, none stops the loop.
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  let matched = false;
  for (const candidate of signaturesOf(signature)) {
    if (equalBytes(candidate, expected)) matched = true;
  }
  if (!matched) {
    throw new WebhookVerificationError("bad-signature", "The webhook signature does not match.");
  }
  let parsed: unknown;
  try {
    parsed = parseEvent(new TextDecoder().decode(bytes));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // No `cause`: a JSON.parse message quotes the start of the body, and the body holds users' personal data.
    throw new WebhookVerificationError("bad-body", "The webhook body is not JSON.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("type" in parsed) ||
    typeof parsed.type !== "string"
  ) {
    throw new WebhookVerificationError("bad-body", "The webhook body has no event type.");
  }
  return parsed as WebhookEvent;
}
