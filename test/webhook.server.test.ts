import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook, WebhookVerificationError } from "../src/server/webhook";

/**
 * Svix signing (the scheme Clerk uses for webhooks): HMAC-SHA256 over `${id}.${timestamp}.${body}`
 * with the base64-decoded part of the `whsec_` secret; the header lists `v1,<base64>` signatures.
 *
 * The vectors below were computed once with `node:crypto` (not with the code under test), so a
 * mistake in the verifier cannot also be a mistake in the expected value.
 */
const FIXED = {
  secret: "whsec_MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  id: "msg_2KjvVq1Y8hZk1Pz7Ql3nE9rXoaB",
  timestamp: "1767950000",
  body: '{"type":"user.created","data":{"id":"user_123","first_name":"Ada"},"object":"event"}',
  signature: "vdwz3qgEixsrzC/RdEpGTukHNe9L9pyXpmF5SiE1hfk=",
};

/** Signs with an independent implementation, so tests can build vectors for any input. */
function sign(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

function webhookRequest(body: string, headers: Record<string, string | undefined>): Request {
  const init: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) if (value !== undefined) init[name] = value;
  return new Request("https://app.example.com/api/clerk/webhook", {
    method: "POST",
    headers: init,
    body,
  });
}

const goodHeaders = (signature = `v1,${FIXED.signature}`) => ({
  "svix-id": FIXED.id,
  "svix-timestamp": FIXED.timestamp,
  "svix-signature": signature,
});

/** The verifier's clock, set to the moment of the fixed vector. */
const atSigning = { now: () => Number(FIXED.timestamp) };

describe("verifyWebhook: Svix signatures", () => {
  it("[WH-1] the fixed vector verifies and returns the parsed event", async () => {
    const event = await verifyWebhook(webhookRequest(FIXED.body, goodHeaders()), {
      secret: FIXED.secret,
      ...atSigning,
    });
    expect(event).toEqual({
      type: "user.created",
      data: { id: "user_123", first_name: "Ada" },
      object: "event",
    });
  });

  it("[WH-2] vectors generated for other ids, bodies and secrets verify too", async () => {
    const cases = [
      {
        secret: `whsec_${Buffer.from("k".repeat(24)).toString("base64")}`,
        id: "msg_a",
        ts: "1700000000",
        body: '{"type":"a.b","data":{}}',
      },
      {
        secret: `whsec_${Buffer.from([0, 255, 16, 32]).toString("base64")}`,
        id: "msg_b",
        ts: "1800000000",
        body: '{"type":"x.y","data":{"n":1}}',
      },
    ];
    for (const item of cases) {
      const signature = sign(item.secret, item.id, item.ts, item.body);
      const request = webhookRequest(item.body, {
        "svix-id": item.id,
        "svix-timestamp": item.ts,
        "svix-signature": `v1,${signature}`,
      });
      const event = await verifyWebhook(request, {
        secret: item.secret,
        now: () => Number(item.ts),
      });
      expect(event.type).toBe(JSON.parse(item.body).type);
    }
  });

  it("[WH-3] a list of signatures verifies when any one of them matches (key rotation)", async () => {
    const event = await verifyWebhook(
      webhookRequest(FIXED.body, goodHeaders(`v1,AAAA v1,${FIXED.signature} v2,zzz`)),
      { secret: FIXED.secret, ...atSigning },
    );
    expect(event.type).toBe("user.created");
  });

  it("[WH-4] a tampered body is rejected with reason bad-signature", async () => {
    const tampered = FIXED.body.replace("Ada", "Eve");
    const failure = await verifyWebhook(webhookRequest(tampered, goodHeaders()), {
      secret: FIXED.secret,
      ...atSigning,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(WebhookVerificationError);
    expect((failure as WebhookVerificationError).reason).toBe("bad-signature");
  });

  it("[WH-5] a signature made with another secret is rejected", async () => {
    const other = `whsec_${Buffer.from("another-secret-of-32-bytes-long!").toString("base64")}`;
    const failure = await verifyWebhook(webhookRequest(FIXED.body, goodHeaders()), {
      secret: other,
      ...atSigning,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((failure as WebhookVerificationError).reason).toBe("bad-signature");
  });

  it("[WH-6] a timestamp older or newer than the tolerance (default 300 s) is rejected", async () => {
    const reason = async (now: number, tolerance?: number) =>
      verifyWebhook(webhookRequest(FIXED.body, goodHeaders()), {
        secret: FIXED.secret,
        now: () => now,
        ...(tolerance === undefined ? {} : { toleranceSeconds: tolerance }),
      }).then(
        () => "accepted",
        (error: unknown) => (error as WebhookVerificationError).reason,
      );
    const t = Number(FIXED.timestamp);
    expect(await reason(t + 300)).toBe("accepted");
    expect(await reason(t + 301)).toBe("timestamp-out-of-tolerance");
    expect(await reason(t - 301)).toBe("timestamp-out-of-tolerance");
    expect(await reason(t + 1000, 2000)).toBe("accepted");
  });

  it("[WH-7] missing svix headers are rejected before any crypto runs", async () => {
    const failure = await verifyWebhook(webhookRequest(FIXED.body, { "svix-id": FIXED.id }), {
      secret: FIXED.secret,
      ...atSigning,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((failure as WebhookVerificationError).reason).toBe("missing-headers");
  });

  it("[WH-8] a secret that is not whsec_ plus base64 is rejected as a configuration error, without echoing it", async () => {
    const failure = await verifyWebhook(webhookRequest(FIXED.body, goodHeaders()), {
      secret: "not-a-secret-value-123",
      ...atSigning,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as Error).message).not.toContain("not-a-secret-value-123");
  });

  it("[WH-9] a body that is not JSON after a valid signature is rejected", async () => {
    const body = "not json";
    const signature = sign(FIXED.secret, FIXED.id, FIXED.timestamp, body);
    const failure = await verifyWebhook(webhookRequest(body, goodHeaders(`v1,${signature}`)), {
      secret: FIXED.secret,
      ...atSigning,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((failure as WebhookVerificationError).reason).toBe("bad-body");
  });

  it("[WH-10] the signature comparison is not a string comparison: a signature of the wrong length is rejected", async () => {
    const failure = await verifyWebhook(
      webhookRequest(FIXED.body, goodHeaders(`v1,${FIXED.signature.slice(0, 10)}`)),
      { secret: FIXED.secret, ...atSigning },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((failure as WebhookVerificationError).reason).toBe("bad-signature");
  });
});
