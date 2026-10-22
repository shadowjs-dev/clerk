import { cleanup, flush } from "@shadow-js/testing/dom";
import { afterEach, describe, expect, it } from "vitest";
import { useReverification } from "../src/index";
import { mountProvider } from "./support/app";
import { FakeClerk } from "./support/fake-clerk";

afterEach(() => cleanup());

/** A hint the server returns when a sensitive change needs a fresh verification (Clerk's wire shape). */
function reverificationHint(reverification: unknown) {
  return {
    clerk_error: {
      type: "forbidden",
      reason: "reverification-error",
      metadata: { reverification },
    },
  };
}

/** Mounts `useReverification(fetcher)` under a loaded fake Clerk; returns the wrapped action and the fake. */
async function mounted(fetcher: () => Promise<unknown>) {
  const clerk = new FakeClerk();
  const { value } = mountProvider(() => useReverification(fetcher), { clerk });
  await flush();
  return { run: value, clerk };
}

describe("useReverification", () => {
  it("[REV-01] returns the action's result and opens no dialog when the session is fresh enough", async () => {
    let runs = 0;
    const { run, clerk } = await mounted(() => {
      runs += 1;
      return Promise.resolve({ ok: true });
    });
    expect(await run()).toEqual({ ok: true });
    expect(runs).toBe(1);
    expect(clerk.count("__internal_openReverification")).toBe(0);
  });

  it("[REV-02] opens the verification dialog at the level the server asked for, then runs the action again", async () => {
    const answers = [reverificationHint("strict"), { ok: true }];
    let runs = 0;
    const { run, clerk } = await mounted(() => {
      const answer = answers[runs];
      runs += 1;
      return Promise.resolve(answer);
    });
    expect(await run()).toEqual({ ok: true });
    expect(runs).toBe(2);
    const [dialog] = clerk.callsTo("__internal_openReverification").map((call) => call.args[0]);
    expect((dialog as { level?: string }).level).toBe("second_factor");
  });

  it("[REV-04] a Clerk without the verification dialog fails with an explicit error and never runs the action unverified", async () => {
    let runs = 0;
    const clerk = new FakeClerk();
    Reflect.deleteProperty(clerk, "__internal_openReverification");
    const { value } = mountProvider(
      () =>
        useReverification(() => {
          runs += 1;
          return Promise.resolve(reverificationHint("strict"));
        }),
      { clerk },
    );
    await flush();
    await expect(value()).rejects.toThrow("which this Clerk instance does not have");
    expect(runs).toBe(1);
  });

  it("[REV-03] a canceled verification rejects with reverification_cancelled and runs the action once", async () => {
    let runs = 0;
    const { run, clerk } = await mounted(() => {
      runs += 1;
      return Promise.resolve(reverificationHint(undefined));
    });
    clerk.reverificationOutcome = "canceled";
    await expect(run()).rejects.toMatchObject({ code: "reverification_cancelled" });
    expect(runs).toBe(1);
  });

  it("[REV-04] an API error that asks for a verification is handled like the hint", async () => {
    let runs = 0;
    const { run } = await mounted(() => {
      runs += 1;
      if (runs === 1) {
        return Promise.reject({ errors: [{ code: "session_reverification_required" }] });
      }
      return Promise.resolve({ ok: "after" });
    });
    expect(await run()).toEqual({ ok: "after" });
    expect(runs).toBe(2);
  });
});
