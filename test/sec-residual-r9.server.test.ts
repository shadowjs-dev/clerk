import { describe, expect, it, vi } from "vitest";
import { authenticateRequest, type ClerkServerOptions } from "../src/server";
import { checkServerOptions } from "../src/server/options";

/**
 * SEC-R9: `authorizedParties` is the only thing that stops a token minted for another application on
 * the same Clerk instance from signing a user in here. The package reads no environment, so the
 * instance type comes from the key: `sk_live_` is a production instance, `sk_test_` a development one.
 * A production instance must list its origins or opt out explicitly with `authorizedParties: false`;
 * a development instance that leaves it unset gets one warning.
 */

const b64 = (text: string): string => Buffer.from(text).toString("base64");

const LIVE: ClerkServerOptions = {
  secretKey: "sk_live_r9_secret_value_do_not_log",
  publishableKey: `pk_live_${b64("clerk.example.com")}`,
};

/** A development instance with its own publishable key, so each test sees the warning once. */
function devOptions(label: string): ClerkServerOptions {
  return {
    secretKey: "sk_test_r9_secret_value_do_not_log",
    publishableKey: `pk_test_${b64(`${label}.example.com`)}`,
  };
}

describe("SEC-R9 Clerk authorizedParties", () => {
  it("SEC-R9-01 refuses a production instance (sk_live_) with authorizedParties unset, naming the setting and not the secret", () => {
    let message = "";
    try {
      checkServerOptions({ ...LIVE });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("TypeError");
    expect(message).toContain("authorizedParties");
    expect(message).not.toContain(LIVE.secretKey);
  });

  it("SEC-R9-02 authenticateRequest refuses the same production configuration before any request is read", async () => {
    const request = new Request("https://app.example.com/api");
    await expect(authenticateRequest(request, { ...LIVE })).rejects.toThrow(/authorizedParties/);
  });

  it("SEC-R9-03 an explicit authorizedParties: false is the opt-out and is accepted silently on a production instance", () => {
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    const checked = checkServerOptions({ ...LIVE, authorizedParties: false });
    expect(checked.authorizedParties).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("SEC-R9-04 a development instance with authorizedParties unset is accepted with one warning that names the setting", () => {
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    const options = devOptions("r9-04");
    checkServerOptions(options);
    checkServerOptions({ ...options });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("authorizedParties");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(options.secretKey);
    warn.mockClear();
  });

  it("SEC-R9-05 a development instance with a list, or with false, is silent", () => {
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    checkServerOptions({ ...devOptions("r9-05a"), authorizedParties: ["https://app.example.com"] });
    checkServerOptions({ ...devOptions("r9-05b"), authorizedParties: false });
    expect(warn).not.toHaveBeenCalled();
  });

  it("SEC-R9-06 a list is still validated, and a value that is neither a list nor false is refused", () => {
    expect(() =>
      checkServerOptions({ ...LIVE, authorizedParties: true as unknown as false }),
    ).toThrow(/authorizedParties must be a list of non-empty origins/);
    expect(() => checkServerOptions({ ...LIVE, authorizedParties: [""] })).toThrow(
      /authorizedParties/,
    );
  });

  it("SEC-R9-07 a production list is accepted and copied", () => {
    const list = ["https://app.example.com"];
    const checked = checkServerOptions({ ...LIVE, authorizedParties: list });
    expect(checked.authorizedParties).toEqual(["https://app.example.com"]);
    expect(checked.authorizedParties).not.toBe(list);
  });
});
