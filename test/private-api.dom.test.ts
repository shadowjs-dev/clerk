import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  openVerificationDialog,
  readClerkState,
  reloadClientResources,
} from "../src/internal/private-api";
import type { ClerkLike, ClerkReverificationProps } from "../src/types";
import { FakeClerk } from "./support/fake-clerk";

/** A Clerk without clerk-js's internal reload (a later clerk-js release, or a stand-in). */
function withoutInternalReload(): FakeClerk {
  const clerk = new FakeClerk();
  Reflect.deleteProperty(clerk, "__internal_reloadInitialResources");
  return clerk;
}

/** A Clerk without clerk-js's verification dialog. */
function withoutDialog(): FakeClerk {
  const clerk = new FakeClerk();
  Reflect.deleteProperty(clerk, "__internal_openReverification");
  return clerk;
}

const dialogProps: ClerkReverificationProps = {
  level: "second_factor",
  afterVerification: () => undefined,
  afterVerificationCancelled: () => undefined,
};

describe("clerk-js internal reload (reloadClientResources)", () => {
  it("[PAPI-01] uses clerk-js's internal reload when the member is a function, and reports that it reloaded", async () => {
    const clerk = new FakeClerk();
    await expect(reloadClientResources(clerk)).resolves.toBe(true);
    expect(clerk.count("__internal_reloadInitialResources")).toBe(1);
  });

  it("[PAPI-02] without the internal member it uses the client's public reload", async () => {
    const clerk = withoutInternalReload();
    let reloads = 0;
    clerk.client = {
      signIn: undefined,
      signUp: undefined,
      reload: () => {
        reloads += 1;
        return Promise.resolve();
      },
    } as NonNullable<FakeClerk["client"]>;
    await expect(reloadClientResources(clerk)).resolves.toBe(true);
    expect(reloads).toBe(1);
  });

  it("[PAPI-03] with neither member it does nothing and reports that it did not reload", async () => {
    const clerk = withoutInternalReload();
    clerk.client = undefined;
    await expect(reloadClientResources(clerk)).resolves.toBe(false);
  });

  it("[PAPI-04] a member that is not a function is never called (a changed clerk-js shape is a branch, not a TypeError)", async () => {
    const clerk = withoutInternalReload();
    clerk.client = undefined;
    (clerk as unknown as Record<string, unknown>)["__internal_reloadInitialResources"] = "renamed";
    await expect(reloadClientResources(clerk)).resolves.toBe(false);
  });

  it("[PAPI-05] a rejected reload rejects: the adapter never swallows a failure", async () => {
    const clerk = new FakeClerk();
    const failure = new Error("network");
    clerk.__internal_reloadInitialResources = () => Promise.reject(failure);
    await expect(reloadClientResources(clerk)).rejects.toBe(failure);
  });
});

describe("clerk-js internal verification dialog (openVerificationDialog)", () => {
  it("[PAPI-06] opens the dialog with the props when the instance has one, and reports that it did", () => {
    const clerk = new FakeClerk();
    expect(openVerificationDialog(clerk, dialogProps)).toBe(true);
    expect(clerk.callsTo("__internal_openReverification")[0]?.args[0]).toBe(dialogProps);
  });

  it("[PAPI-07] without the dialog, or before Clerk has loaded, it reports false and opens nothing", () => {
    const clerk = withoutDialog();
    expect(openVerificationDialog(clerk, dialogProps)).toBe(false);
    expect(openVerificationDialog(null, dialogProps)).toBe(false);
    expect(clerk.calls).toHaveLength(0);
  });

  it("[PAPI-08] a dialog member that is not a function is treated as missing", () => {
    const clerk = withoutDialog();
    (clerk as unknown as Record<string, unknown>)["__internal_openReverification"] = true;
    expect(openVerificationDialog(clerk as ClerkLike, dialogProps)).toBe(false);
  });
});

describe("clerk-js future state (readClerkState)", () => {
  it("[PAPI-10] without __internal_state, or with one of its three members missing or renamed, there is no reader (a branch, never a TypeError)", () => {
    for (const member of [
      "__internal_state",
      "signInSignal",
      "signUpSignal",
      "__internal_effect",
    ]) {
      const clerk = new FakeClerk();
      if (member === "__internal_state") {
        clerk.withoutInternalState();
      } else {
        const state = clerk.__internal_state as unknown as Record<string, unknown>;
        Reflect.deleteProperty(state, member);
      }
      expect(readClerkState(clerk), `without ${member}`).toBeNull();
    }
    const renamed = new FakeClerk();
    (renamed.__internal_state as unknown as Record<string, unknown>)["signInSignal"] = "renamed";
    expect(readClerkState(renamed)).toBeNull();
  });

  it("[PAPI-11] observe runs the listener now, and its dispose ends the single effect subscription", () => {
    const clerk = new FakeClerk();
    clerk.__internal_state?.startFutures();
    const reader = readClerkState(clerk);
    expect(reader).not.toBeNull();
    const seen: unknown[] = [];
    const problems: string[] = [];
    const stop = reader?.observe(
      (flows) => seen.push(flows.signIn.resource),
      (message) => problems.push(message),
    );
    expect(seen).toHaveLength(1);
    expect(clerk.count("__internal_effect")).toBe(1);
    expect(problems).toEqual([]);
    stop?.();
    expect(clerk.count("effect.dispose")).toBe(1);
  });
});

describe("the adapter is the only place that names clerk-js internals", () => {
  /** Every `.ts`/`.tsx` file under `src`, relative to the package. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry) ? [path] : [];
    });
  }

  it("[PAPI-09] only private-api.ts mentions __internal_", () => {
    const src = join(import.meta.dirname, "..", "src");
    const allowed = new Set(["internal/private-api.ts"]);
    const offenders = sourceFiles(src)
      .map((file) => file.slice(src.length + 1))
      .filter((file) => !allowed.has(file))
      .filter((file) => readFileSync(join(src, file), "utf8").includes("__internal_"));
    expect(offenders).toEqual([]);
  });
});
