import { createHmac } from "node:crypto";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { equalBytes, verifyWebhook, WebhookVerificationError } from "../src/server/webhook";

/**
 * PASS 2, scope A (Clerk), webhooks. The signing scheme is Svix's: HMAC-SHA256 over `${id}.${timestamp}.${body}`
 * with the key inside `whsec_`. Vectors here are signed with `node:crypto`, not with the code under test.
 */

const KEY = Buffer.from("sec2-webhook-signing-key-0123456789");
const SECRET = `whsec_${KEY.toString("base64")}`;
const NOW = 1_800_000_000;
const clock = { now: () => NOW };

function mac(id: string, timestamp: string, body: string | Uint8Array): string {
  const hmac = createHmac("sha256", KEY).update(`${id}.${timestamp}.`);
  hmac.update(body);
  return hmac.digest("base64");
}

function request(
  body: string | Uint8Array,
  headers: Record<string, string>,
  method = "POST",
): Request {
  const init: RequestInit = {
    method,
    headers,
    body: typeof body === "string" ? body : new Blob([Uint8Array.from(body)]),
  };
  return new Request("https://app.example.com/api/clerk/webhook", init);
}

const EVENT = JSON.stringify({ type: "user.created", data: { id: "user_1" } });

/** A request signed correctly for the given parts; `signature` replaces the header when given. */
function signed(
  options: {
    id?: string;
    timestamp?: number | string;
    body?: string | Uint8Array;
    signature?: string;
  } = {},
): Request {
  const id = options.id ?? "msg_1";
  const timestamp = String(options.timestamp ?? NOW);
  const body = options.body ?? EVENT;
  return request(body, {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": options.signature ?? `v1,${mac(id, timestamp, body)}`,
  });
}

async function failure(promise: Promise<unknown>): Promise<WebhookVerificationError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(WebhookVerificationError);
  if (!(error instanceof WebhookVerificationError)) throw new Error("unreachable");
  return error;
}

/** Spies of the test that is running; restored alone, because the shared setup reads the console spies afterward. */
const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("SEC2-CLERK-6x the comparison", () => {
  it("[SEC2-CLERK-60] the expected MAC is computed once however many signatures the header lists", async () => {
    const operations = { sign: 0, verify: 0 };
    const subtle = crypto.subtle;
    const sign = subtle.sign.bind(subtle);
    const verify = subtle.verify.bind(subtle);
    spies.push(
      vi.spyOn(subtle, "sign").mockImplementation((...args: Parameters<typeof sign>) => {
        operations.sign += 1;
        return sign(...args);
      }),
      vi.spyOn(subtle, "verify").mockImplementation((...args: Parameters<typeof verify>) => {
        operations.verify += 1;
        return verify(...args);
      }),
    );
    const junk = Array.from(
      { length: 4000 },
      (_, i) => `v1,${Buffer.from(`junk-${i}`.padEnd(32, "x")).toString("base64")}`,
    );
    await failure(
      verifyWebhook(signed({ signature: junk.join(" ") }), { secret: SECRET, ...clock }),
    );
    expect(operations.sign + operations.verify).toBeLessThanOrEqual(1);
  });

  it("[SEC2-CLERK-61] equalBytes is exact: equal bytes, a one-bit difference anywhere and a different length", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 40 }),
        fc.nat(),
        fc.integer({ min: 0, max: 7 }),
        (bytes, at, bit) => {
          expect(equalBytes(bytes, Uint8Array.from(bytes))).toBe(true);
          if (bytes.length === 0) return;
          const flipped = Uint8Array.from(bytes);
          const index = at % bytes.length;
          flipped[index] = (flipped[index] ?? 0) ^ (1 << bit);
          expect(equalBytes(bytes, flipped)).toBe(false);
          expect(equalBytes(bytes, bytes.slice(0, -1))).toBe(false);
        },
      ),
      { seed: 20261010, numRuns: 300 },
    );
  });

  it("[SEC2-CLERK-62] several signatures: any valid one passes, none valid does not, and the list is bounded", async () => {
    const good = mac("msg_1", String(NOW), EVENT);
    const bad = (n: number): string =>
      `v1,${Buffer.from(`bad-${n}`.padEnd(32, "x")).toString("base64")}`;
    const options = { secret: SECRET, ...clock };
    for (const header of [
      `v1,${good}`,
      `${bad(1)} v1,${good}`,
      `v1,${good} ${bad(1)}`,
      `${bad(1)} ${bad(2)} v1,${good} ${bad(3)}`,
      `v0,xxxx v1,${good}`,
      `v1,${good} v2,${good}`,
      // empty entries from repeated spaces are skipped
      `${bad(1)}  v1,${good}`,
    ]) {
      expect((await verifyWebhook(signed({ signature: header }), options)).type, header).toBe(
        "user.created",
      );
    }
    for (const header of [
      bad(1),
      `${bad(1)} ${bad(2)}`,
      `v2,${good}`,
      `V1,${good}`,
      `v1 ${good}`,
      `v1,${good.slice(0, -4)}`,
      `v1,${good}AA`,
      `v1,`,
      "v1",
      ",",
      " ",
      "",
      "v1,!!!",
      `${good}`,
      `v1,${good.replace(/[A-Za-z]/, "-")}`,
    ]) {
      const error = await failure(verifyWebhook(signed({ signature: header }), options));
      expect(["bad-signature", "missing-headers"], header).toContain(error.reason);
    }
    // The valid signature is the 17th: past the bound it is not read.
    const long = [...Array.from({ length: 16 }, (_, n) => bad(n)), `v1,${good}`].join(" ");
    expect((await failure(verifyWebhook(signed({ signature: long }), options))).reason).toBe(
      "bad-signature",
    );
    const within = [...Array.from({ length: 15 }, (_, n) => bad(n)), `v1,${good}`].join(" ");
    expect((await verifyWebhook(signed({ signature: within }), options)).type).toBe("user.created");
  });

  it("[SEC2-CLERK-63] a signature over other parts does not verify: another id, timestamp, body or secret", async () => {
    const options = { secret: SECRET, ...clock };
    const other = (id: string, timestamp: string, body: string): string =>
      `v1,${mac(id, timestamp, body)}`;
    const variants = [
      signed({ signature: other("msg_2", String(NOW), EVENT) }),
      signed({ signature: other("msg_1", String(NOW - 1), EVENT) }),
      signed({ signature: other("msg_1", String(NOW), `${EVENT} `) }),
      signed({ body: `${EVENT} `, signature: other("msg_1", String(NOW), EVENT) }),
      // id and timestamp are joined by a dot: moving a dot between them does not move the signature
      signed({
        id: "msg_1.1799999999",
        timestamp: NOW,
        signature: other("msg_1", "1799999999", `${NOW}.${EVENT}`),
      }),
    ];
    for (const variant of variants)
      expect((await failure(verifyWebhook(variant, options))).reason).toBe("bad-signature");
    const wrongSecret = `whsec_${Buffer.from("another-secret-value-0123456789!").toString("base64")}`;
    expect((await failure(verifyWebhook(signed(), { secret: wrongSecret, ...clock }))).reason).toBe(
      "bad-signature",
    );
  });

  it("[SEC2-CLERK-64] the signature covers the raw bytes: a byte-order mark or a rewritten invalid byte is a different body", async () => {
    const options = { secret: SECRET, ...clock };
    const json = new TextEncoder().encode(EVENT);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...json]);
    // A body with a BOM decodes to the same text as the one without; the signature must not accept it.
    const bom = request(withBom, {
      "svix-id": "msg_1",
      "svix-timestamp": String(NOW),
      "svix-signature": `v1,${mac("msg_1", String(NOW), json)}`,
    });
    expect((await failure(verifyWebhook(bom, options))).reason).toBe("bad-signature");
    // A body that Svix signed with invalid UTF-8 inside a string verifies over its raw bytes.
    const raw = new Uint8Array([
      ...new TextEncoder().encode('{"type":"a.b","data":{"x":"'),
      0xff,
      0xfe,
      ...new TextEncoder().encode('"}}'),
    ]);
    const event = await verifyWebhook(signed({ body: raw }), options);
    expect(event.type).toBe("a.b");
    // The same text with the bytes replaced by what a lenient decoder writes is another body.
    const replaced = new TextEncoder().encode(new TextDecoder().decode(raw));
    const forged = request(replaced, {
      "svix-id": "msg_1",
      "svix-timestamp": String(NOW),
      "svix-signature": `v1,${mac("msg_1", String(NOW), raw)}`,
    });
    expect((await failure(verifyWebhook(forged, options))).reason).toBe("bad-signature");
  });
});

describe("SEC2-CLERK-6x the clock", () => {
  const options = { secret: SECRET, ...clock };

  it("[SEC2-CLERK-65] the tolerance is inclusive at 300 seconds, in the past and in the future, and refuses one second more", async () => {
    for (const offset of [0, -1, 1, -299, 299, -300, 300]) {
      expect(
        (await verifyWebhook(signed({ timestamp: NOW + offset }), options)).type,
        String(offset),
      ).toBe("user.created");
    }
    for (const offset of [-301, 301, -3600, 3600, -(10 ** 9), 10 ** 9]) {
      const error = await failure(verifyWebhook(signed({ timestamp: NOW + offset }), options));
      expect(error.reason, String(offset)).toBe("timestamp-out-of-tolerance");
    }
  });

  it("[SEC2-CLERK-66] a custom tolerance of zero accepts only the current second", async () => {
    expect((await verifyWebhook(signed(), { ...options, toleranceSeconds: 0 })).type).toBe(
      "user.created",
    );
    const error = await failure(
      verifyWebhook(signed({ timestamp: NOW + 1 }), { ...options, toleranceSeconds: 0 }),
    );
    expect(error.reason).toBe("timestamp-out-of-tolerance");
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a negative number", -1],
    ["a string", "300" as unknown as number],
  ])(
    "[SEC2-CLERK-67] a tolerance of %s is a configuration error, not a switch that turns replay protection off",
    async (_name, toleranceSeconds) => {
      // `Math.abs(now - timestamp) > NaN` is false for every timestamp: a one-year-old request would verify.
      await expect(
        verifyWebhook(signed({ timestamp: NOW - 31_536_000 }), { ...options, toleranceSeconds }),
      ).rejects.toThrow(/toleranceSeconds/);
    },
  );

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["zero", 0],
    ["a negative number", -5],
  ])(
    "[SEC2-CLERK-68] a body limit of %s is a configuration error, not an unbounded read",
    async (_name, maxBodyBytes) => {
      await expect(verifyWebhook(signed(), { ...options, maxBodyBytes })).rejects.toThrow(
        /maxBodyBytes/,
      );
    },
  );

  it.each([
    ["a fraction", "1800000000.5"],
    ["a leading space", " 1800000000"],
    ["a trailing space", "1800000000 "],
    ["an exponent", "1.8e9"],
    ["a sign", "+1800000000"],
    ["a negative number", "-1800000000"],
    ["a hex number", "0x6B49D200"],
    ["an empty value", ""],
    ["text", "now"],
  ])("[SEC2-CLERK-69] a timestamp that is %s is refused", async (_name, timestamp) => {
    const headers = {
      "svix-id": "msg_1",
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${mac("msg_1", timestamp, EVENT)}`,
    };
    const error = await failure(verifyWebhook(request(EVENT, headers), options));
    // `Headers` trims the spaces, so the timestamp that is read differs from the one that was signed.
    expect(["bad-timestamp", "missing-headers", "bad-signature"]).toContain(error.reason);
  });

  it("[SEC2-CLERK-70] a timestamp with hundreds of digits is out of tolerance, not accepted as Infinity or NaN", async () => {
    const huge = "9".repeat(400);
    const error = await failure(verifyWebhook(signed({ timestamp: huge }), options));
    expect(error.reason).toBe("timestamp-out-of-tolerance");
  });

  it("[SEC2-CLERK-71] the same request verifies again inside the window: no event is remembered (deduplicate by svix-id)", async () => {
    const first = await verifyWebhook(signed(), options);
    const again = await verifyWebhook(signed(), options);
    expect(again).toEqual(first);
  });
});

describe("SEC2-CLERK-7x headers, body and event", () => {
  const options = { secret: SECRET, ...clock };

  it("[SEC2-CLERK-72] header names are case-insensitive and the alternative webhook-* names are not read", async () => {
    const upper = request(EVENT, {
      "SVIX-ID": "msg_1",
      "Svix-Timestamp": String(NOW),
      "sViX-SiGnAtUrE": `v1,${mac("msg_1", String(NOW), EVENT)}`,
    });
    expect((await verifyWebhook(upper, options)).type).toBe("user.created");
    const standard = request(EVENT, {
      "webhook-id": "msg_1",
      "webhook-timestamp": String(NOW),
      "webhook-signature": `v1,${mac("msg_1", String(NOW), EVENT)}`,
    });
    expect((await failure(verifyWebhook(standard, options))).reason).toBe("missing-headers");
  });

  it("[SEC2-CLERK-73] a repeated header is one comma-joined value, which no signature covers", async () => {
    const headers = new Headers({
      "svix-timestamp": String(NOW),
      "svix-signature": `v1,${mac("msg_1", String(NOW), EVENT)}`,
    });
    headers.append("svix-id", "msg_1");
    headers.append("svix-id", "msg_1");
    const duplicated = new Request("https://app.example.com/w", {
      method: "POST",
      headers,
      body: EVENT,
    });
    expect((await failure(verifyWebhook(duplicated, options))).reason).toBe("bad-signature");
  });

  it("[SEC2-CLERK-74] a body of exactly the limit is read; one byte more is refused, counted in bytes", async () => {
    const body = JSON.stringify({ type: "t.t", data: { pad: "é".repeat(20) } });
    const size = new TextEncoder().encode(body).length;
    expect(size).toBeGreaterThan(body.length);
    expect((await verifyWebhook(signed({ body }), { ...options, maxBodyBytes: size })).type).toBe(
      "t.t",
    );
    expect(
      (await failure(verifyWebhook(signed({ body }), { ...options, maxBodyBytes: size - 1 })))
        .reason,
    ).toBe("body-too-large");
    expect(
      (await failure(verifyWebhook(signed({ body }), { ...options, maxBodyBytes: body.length })))
        .reason,
    ).toBe("body-too-large");
  });

  it("[SEC2-CLERK-75] a request with no body is refused as unsigned, not read as an empty event", async () => {
    const get = new Request("https://app.example.com/w", {
      headers: {
        "svix-id": "msg_1",
        "svix-timestamp": String(NOW),
        "svix-signature": `v1,${mac("msg_1", String(NOW), "")}`,
      },
    });
    expect((await failure(verifyWebhook(get, options))).reason).toBe("bad-body");
  });

  it("[SEC2-CLERK-76] a signed body that is not an event object is refused", async () => {
    for (const body of [
      "[]",
      "null",
      '"text"',
      "7",
      "{}",
      '{"type":7}',
      '{"type":null}',
      "{",
      "",
    ]) {
      const error = await failure(verifyWebhook(signed({ body }), options));
      expect(error.reason, body).toBe("bad-body");
    }
  });

  it("[SEC2-CLERK-77] the keys that make a later merge pollute prototypes are dropped from a signed event", async () => {
    // `unsafe_metadata` is written by the user's browser; Clerk signs it into user.updated.
    const body =
      '{"type":"user.updated","__proto__":{"admin":true},"data":{"id":"u","unsafe_metadata":{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}},"ok":1,"nested":[{"__proto__":{"a":1}}]}}}';
    const event = await verifyWebhook(signed({ body }), options);
    expect(Object.hasOwn(event, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(event)).toBe(Object.prototype);
    const metadata = event.data["unsafe_metadata"] as Record<string, unknown>;
    expect(Object.hasOwn(metadata, "__proto__")).toBe(false);
    expect(Object.hasOwn(metadata, "constructor")).toBe(false);
    expect(metadata["ok"]).toBe(1);
    const merged: Record<string, unknown> = {};
    Object.assign(merged, metadata);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["isAdmin"]).toBeUndefined();
    // A key named constructor with a plain value is data and stays.
    const plain = await verifyWebhook(
      signed({ body: '{"type":"a.b","data":{"constructor":"Acme"}}' }),
      options,
    );
    expect(plain.data["constructor"]).toBe("Acme");
  });

  it("[SEC2-CLERK-78] no failure message holds the secret, the signature or the body", async () => {
    const secretBody = '{"type":"a.b","data":{"token":"SENSITIVE_BODY_VALUE"}}';
    const cases: Array<() => Promise<unknown>> = [
      () => verifyWebhook(signed({ body: secretBody, signature: "v1,AAAA" }), options),
      () => verifyWebhook(signed({ body: secretBody, timestamp: 5 }), options),
      () => verifyWebhook(signed({ body: secretBody, timestamp: "x" }), options),
      () => verifyWebhook(signed({ body: "SENSITIVE_BODY_VALUE" }), options),
      () => verifyWebhook(signed({ body: secretBody }), { ...options, maxBodyBytes: 4 }),
      () =>
        verifyWebhook(signed({ body: secretBody }), {
          secret: "whsec_%%%SENSITIVE_SECRET",
          ...clock,
        }),
    ];
    for (const run of cases) {
      const error: unknown = await run().then(
        () => undefined,
        (reason: unknown) => reason,
      );
      const text = `${String(error)} ${JSON.stringify(error, Object.getOwnPropertyNames(error as object))}`;
      expect(text).not.toContain("SENSITIVE_BODY_VALUE");
      expect(text).not.toContain("SENSITIVE_SECRET");
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(KEY.toString("base64"));
    }
  });
});
