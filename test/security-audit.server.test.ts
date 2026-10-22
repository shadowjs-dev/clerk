import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authenticateRequest } from "../src/server/authenticate";
import { createRouteMatcher } from "../src/server/route-matcher";
import { verifyWebhook, WebhookVerificationError } from "../src/server/webhook";

describe("SEC-17x Clerk route matcher", () => {
  const isProtected = createRouteMatcher(["/dashboard(.*)", "/admin(.*)"]);

  it.each([
    "/DASHBOARD",
    "/Dashboard/settings",
    "/%64ashboard",
    "/%64ashboard/x",
    "/dashboard%2Fsecret",
  ])(
    "[SEC-170] the rule for /dashboard covers %s, which the Dusk router serves as the dashboard page",
    (path) => {
      expect(isProtected(path)).toBe(true);
    },
  );

  it("[SEC-171] a pattern with several wildcards answers a 1000-segment path in well under 100 ms", () => {
    const matcher = createRouteMatcher(["/*/*/*/x"]);
    const path = `/${"a/".repeat(1000)}y`;
    const started = performance.now();
    expect(matcher(path)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("[SEC-172] a pattern with a wildcard in the middle of a segment keeps every literal after it", () => {
    const matcher = createRouteMatcher(["/files/*-report*pdf"]);
    expect(matcher("/files/x-report-2024.pdf")).toBe(true);
    expect(matcher("/files/x-report-2024.txt")).toBe(false);
  });
});

describe("SEC-18x Clerk webhook body", () => {
  const secret = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;

  it("[SEC-180] a body is read only up to a bound before its signature is checked", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(65_536));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        if (pulled > 16 * 1024 * 1024) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const request = new Request("https://app.example/webhooks", {
      method: "POST",
      headers: { "svix-id": "msg_1", "svix-timestamp": timestamp, "svix-signature": "v1,AAAA" },
      body,
      duplex: "half",
    } as RequestInit);
    await expect(verifyWebhook(request, { secret })).rejects.toBeInstanceOf(
      WebhookVerificationError,
    );
    expect(pulled).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("[SEC-181] a valid signature verifies, and the event is returned", async () => {
    const id = "msg_2";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({ type: "user.created", data: { id: "user_1" } });
    const key = Buffer.from("0123456789abcdef0123456789abcdef");
    const signature = createHmac("sha256", key)
      .update(`${id}.${timestamp}.${payload}`)
      .digest("base64");
    const request = new Request("https://app.example/webhooks", {
      method: "POST",
      headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` },
      body: payload,
    });
    const event = await verifyWebhook(request, { secret });
    expect(event.type).toBe("user.created");
  });

  it("[SEC-182] a timestamp outside the tolerance is refused before the body is read", async () => {
    const request = new Request("https://app.example/webhooks", {
      method: "POST",
      headers: { "svix-id": "msg_3", "svix-timestamp": "1000", "svix-signature": "v1,AAAA" },
      body: "{}",
    });
    await expect(verifyWebhook(request, { secret })).rejects.toMatchObject({
      reason: "timestamp-out-of-tolerance",
    });
  });

  it("[SEC-183] a malformed secret names the setting and never echoes its value", async () => {
    const request = new Request("https://app.example/webhooks", { method: "POST" });
    await expect(verifyWebhook(request, { secret: "not-a-secret-value" })).rejects.toThrow(
      /secret/,
    );
    await expect(verifyWebhook(request, { secret: "not-a-secret-value" })).rejects.not.toThrow(
      /not-a-secret-value/,
    );
  });
});

describe("SEC-19x Clerk options", () => {
  it("[SEC-190] a missing or malformed key fails at once with a message that names the setting and no value", async () => {
    const request = new Request("https://app.example/");
    await expect(
      authenticateRequest(request, { secretKey: "sk_live_visible-value", publishableKey: "bad" }),
    ).rejects.toThrow(/publishableKey/);
    await expect(
      authenticateRequest(request, {
        secretKey: "wrong_visible-value",
        publishableKey: "pk_test_abc",
      }),
    ).rejects.not.toThrow(/wrong_visible-value/);
  });
});
