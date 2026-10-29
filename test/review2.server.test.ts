import { describe, expect, it } from "vitest";
import { withAnswerHeaders } from "../src/server/handshake";

/** Review round two: the answer headers on a response that cannot be rebuilt. */

/** A response that reports `status`; Node refuses to construct one, a runtime that upgrades a socket does not. */
function reporting(status: number, response: Response): Response {
  Object.defineProperty(response, "status", { value: status });
  return response;
}

describe("withAnswerHeaders: a 101 response", () => {
  const answer = (): Headers => {
    const headers = new Headers({ "x-clerk-auth-status": "signed-in" });
    headers.append("set-cookie", "__session=b; Path=/");
    return headers;
  };

  it("[CLERK-R2-14] does not throw for a 101 upgrade and puts the headers on it in place", () => {
    const upgrade = reporting(101, new Response(null));
    const out = withAnswerHeaders(upgrade, answer());
    expect(out).toBe(upgrade);
    expect(out.headers.get("x-clerk-auth-status")).toBe("signed-in");
    expect(out.headers.getSetCookie()).toEqual(["__session=b; Path=/"]);
  });

  it("[CLERK-R2-14] a 101 whose headers are immutable goes out as it is instead of throwing", () => {
    const upgrade = reporting(101, Response.redirect("https://app.example.com/", 302));
    expect(withAnswerHeaders(upgrade, answer())).toBe(upgrade);
  });
});
