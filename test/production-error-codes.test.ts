import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProduction, messageOf } from "./support/production-build";

type ScriptModule = typeof import("../src/internal/script");

describe("production error codes of the provider script options", () => {
  it("[ERR-CODES-7] a bad publishable key and a bad version carry a CLERK_ code, and the version code names the option", async () => {
    const script = await loadProduction<ScriptModule>(
      join(import.meta.dirname, "../src/internal/script.ts"),
    );
    const key = messageOf(() => script.frontendApiOf("pk_test_bm9wZQ"));
    const jsVersion = messageOf(() =>
      script.clerkJSScriptUrl("h.example", { clerkJSVersion: "not a version" }),
    );
    const uiVersion = messageOf(() =>
      script.clerkUIScriptUrl("h.example", { clerkUIVersion: "not a version" }),
    );
    expect(key).toBe("CLERK_KEY");
    expect(jsVersion).toBe("CLERK_VERSION clerkJSVersion");
    expect(uiVersion).toBe("CLERK_VERSION clerkUIVersion");
    expect(new Set([key, jsVersion, uiVersion]).size).toBe(3);
  });
});
