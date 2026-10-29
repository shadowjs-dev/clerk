import type { ConvexClientLike } from "@shadow-js/convex";
import { createRoot, flushSync } from "@shadow-js/core";
import { cleanup, flush } from "@shadow-js/testing/dom";
import { afterEach, describe, expect, it } from "vitest";
import { ConvexProviderWithClerk } from "../src/convex-react";
import { useReverification } from "../src/index";
import { ClerkProvider } from "../src/provider";
import { mountProvider } from "./support/app";
import { FakeClerk, FakeSession, fakeMembership, fakeOrg, fakeUser } from "./support/fake-clerk";

const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

afterEach(() => cleanup());

type Fetcher = (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>;

/** The next scripted response; a test that asks for more than it scripted fails here. */
function nextOf(answers: readonly Response[], index: number): Response {
  const answer = answers[index];
  if (answer === undefined) throw new Error("no scripted response left");
  return answer;
}

/** A Convex client that records every auth registration and clear. */
class RecordingConvex implements ConvexClientLike {
  readonly fetchers: Fetcher[] = [];
  clears = 0;

  onUpdate(): () => void {
    return () => undefined;
  }

  mutation(): Promise<never> {
    return Promise.reject(new Error("not used"));
  }

  action(): Promise<never> {
    return Promise.reject(new Error("not used"));
  }

  setAuth(fetchToken: Fetcher): void {
    this.fetchers.push(fetchToken);
  }

  clearAuth(): void {
    this.clears += 1;
  }
}

function mount(clerk: FakeClerk, client: ConvexClientLike): () => void {
  const dispose = createRoot((disposeRoot) => {
    ClerkProvider({
      publishableKey: KEY,
      clerk,
      get children() {
        return ConvexProviderWithClerk({ client, children: null });
      },
    });
    return disposeRoot;
  });
  flushSync();
  return dispose;
}

describe("ConvexProviderWithClerk identity changes", () => {
  it("[CLERK-R7-1] registers a new fetcher when the account, the organization or the role changes, and clears on sign-out", async () => {
    const clerk = new FakeClerk();
    const convex = new RecordingConvex();
    const dispose = mount(clerk, convex);
    await flush();
    const first = new FakeSession("sess_1");
    clerk.set({ user: fakeUser("user_1"), session: first });
    flushSync();
    expect(convex.fetchers.length).toBe(1);

    // Another account in the same tab.
    const second = new FakeSession("sess_2");
    clerk.set({ user: fakeUser("user_2"), session: second });
    flushSync();
    expect(convex.fetchers.length).toBe(2);
    expect(convex.fetchers[1]).not.toBe(convex.fetchers[0]);

    // Another organization, same session.
    clerk.set({
      user: fakeUser("user_2", [fakeMembership("org_1", "org:admin")]),
      organization: fakeOrg("org_1"),
    });
    flushSync();
    const afterOrg1 = convex.fetchers.length;
    expect(afterOrg1).toBeGreaterThan(2);
    clerk.set({
      user: fakeUser("user_2", [fakeMembership("org_2", "org:admin")]),
      organization: fakeOrg("org_2"),
    });
    flushSync();
    expect(convex.fetchers.length).toBeGreaterThan(afterOrg1);

    // Same organization, another role.
    const afterOrg2 = convex.fetchers.length;
    clerk.set({
      user: fakeUser("user_2", [fakeMembership("org_2", "org:member")]),
      organization: fakeOrg("org_2"),
    });
    flushSync();
    expect(convex.fetchers.length).toBeGreaterThan(afterOrg2);

    // Nothing changed: no extra registration for an equal emit.
    const stable = convex.fetchers.length;
    clerk.emit();
    flushSync();
    expect(convex.fetchers.length).toBe(stable);

    const clearsBefore = convex.clears;
    clerk.set({ user: null, session: null, organization: null });
    flushSync();
    expect(convex.clears).toBeGreaterThan(clearsBefore);
    expect(convex.fetchers.length).toBe(stable);
    dispose();
  });
});

describe("useReverification responses", () => {
  it("[CLERK-R7-2] a 204 or non-JSON success resolves to the original Response, and the hint is still found in a JSON body", async () => {
    const clerk = new FakeClerk();
    const noContent = new Response(null, { status: 204 });
    const text = new Response("saved", { status: 200 });
    const answers: Response[] = [noContent, text];
    let index = 0;
    const { value: run } = mountProvider(
      () =>
        useReverification(() => {
          const answer = nextOf(answers, index);
          index += 1;
          return Promise.resolve(answer);
        }),
      { clerk },
    );
    await flush();
    const first = await run();
    expect(first).toBe(noContent);
    const second = await run();
    expect(second).toBe(text);
    expect(await second.text()).toBe("saved");
    expect(clerk.count("__internal_openReverification")).toBe(0);
  });

  it("[CLERK-R7-3] a Response carrying the reverification hint opens the dialog and the final Response is returned unread", async () => {
    const clerk = new FakeClerk();
    const hint = new Response(
      JSON.stringify({ clerk_error: { type: "forbidden", reason: "reverification-error" } }),
      { status: 403 },
    );
    const done = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const answers = [hint, done];
    let index = 0;
    const { value: run } = mountProvider(
      () =>
        useReverification(() => {
          const answer = nextOf(answers, index);
          index += 1;
          return Promise.resolve(answer);
        }),
      { clerk },
    );
    await flush();
    const result = await run();
    expect(result).toBe(done);
    expect(await result.json()).toEqual({ ok: true });
    expect(clerk.count("__internal_openReverification")).toBe(1);
  });
});
