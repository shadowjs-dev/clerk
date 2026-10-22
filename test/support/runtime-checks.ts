/**
 * The checks every runtime that loads `@shadow-js/clerk/server` runs. The module imports nothing, and it uses Web APIs
 * only (Request, URL, Web Crypto, TextEncoder), so the same file runs under Node (vitest), Bun, Deno and workerd. A
 * runtime's probe passes the server module in, and the test compares the JSON the probe prints with its expectations.
 * The `runtime` field names the runtime that ran the checks, so a test cannot pass by running under another one.
 */

/** The server functions the checks call: the module's exports, as far as the checks use them. */
export interface ServerChecksModule {
  readonly verifyWebhook: (
    request: Request,
    options: { readonly secret: string; readonly now?: () => number },
  ) => Promise<{ readonly type: string }>;
  readonly createRouteMatcher: (
    patterns: readonly string[],
  ) => (input: Request | string) => boolean;
  readonly WebhookVerificationError: new (
    reason: "bad-signature" | "bad-body",
    message: string,
  ) => Error & { readonly reason: string };
}

/**
 * The Svix vector of `webhook.server.test.ts`, computed with `node:crypto` (not by the code under test), so a mistake in
 * the verifier cannot also be a mistake in the expected value.
 */
export const FIXED = {
  secret: "whsec_MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  id: "msg_2KjvVq1Y8hZk1Pz7Ql3nE9rXoaB",
  timestamp: "1767950000",
  body: '{"type":"user.created","data":{"id":"user_123","first_name":"Ada"},"object":"event"}',
  signature: "vdwz3qgEixsrzC/RdEpGTukHNe9L9pyXpmF5SiE1hfk=",
};

/** The runtime this code runs in, from the global each one defines. */
export function runtimeName(): "bun" | "deno" | "workerd" | "node" {
  if (Reflect.has(globalThis, "Bun")) return "bun";
  if (Reflect.has(globalThis, "Deno")) return "deno";
  if (globalThis.navigator?.userAgent === "Cloudflare-Workers") return "workerd";
  return "node";
}

/** A POST request to a webhook endpoint with the given body and headers. */
function webhookRequest(body: string, headers: Readonly<Record<string, string>>): Request {
  return new Request("https://app.example.com/api/clerk/webhook", {
    method: "POST",
    headers,
    body,
  });
}

/** The three Svix headers of the fixed vector. */
function signedHeaders(): Record<string, string> {
  return {
    "svix-id": FIXED.id,
    "svix-timestamp": FIXED.timestamp,
    "svix-signature": `v1,${FIXED.signature}`,
  };
}

/** The reason a webhook was refused, or `accepted` when it was not. Any other error is reported as `other`. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "accepted";
  } catch (error) {
    if (typeof error === "object" && error !== null && "reason" in error) {
      return String(error.reason);
    }
    return "other";
  }
}

/** The verifier's clock, set to the moment of the fixed vector. */
const AT_SIGNING = { secret: FIXED.secret, now: () => Number(FIXED.timestamp) };

/**
 * Runs the checks against a server module and returns what each one found. Every value is JSON-serializable.
 * @param server The server module (`@shadow-js/clerk/server`, from source or from a build).
 * @returns The results, keyed by check.
 */
export async function runServerChecks(
  server: ServerChecksModule,
): Promise<Record<string, unknown>> {
  const event = await server.verifyWebhook(webhookRequest(FIXED.body, signedHeaders()), AT_SIGNING);
  const isDashboard = server.createRouteMatcher(["/dashboard(.*)"]);
  const error = new server.WebhookVerificationError("bad-body", "a refusal");
  return {
    runtime: runtimeName(),
    // Sorted, so the list does not depend on the order the module declares its exports in.
    exports: Object.keys(server).sort(),
    webhookEventType: event.type,
    tamperedBody: await refusal(() =>
      server.verifyWebhook(webhookRequest(`${FIXED.body} `, signedHeaders()), AT_SIGNING),
    ),
    missingHeaders: await refusal(() =>
      server.verifyWebhook(webhookRequest(FIXED.body, {}), AT_SIGNING),
    ),
    staleTimestamp: await refusal(() =>
      server.verifyWebhook(webhookRequest(FIXED.body, signedHeaders()), {
        ...AT_SIGNING,
        now: () => Number(FIXED.timestamp) + 301,
      }),
    ),
    routes: [
      isDashboard(new Request("https://app.example.com/dashboard/settings")),
      isDashboard("/public"),
    ],
    errorIsError: error instanceof Error,
    errorName: error.name,
  };
}
