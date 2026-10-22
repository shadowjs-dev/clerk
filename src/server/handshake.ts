/**
 * The parts of Clerk's answer that reach the browser: the redirect and cookies of a handshake or a refresh,
 * and the `x-clerk-*` status headers. The session token, its signature and the free-text message never do: the
 * first two are for the application's own server code, which reads them through `getAuth`.
 */
const WITHHELD: ReadonlySet<string> = new Set([
  "x-clerk-auth-token",
  "x-clerk-auth-signature",
  // Free text built from the request: it repeats attacker-chosen claim values and names the expected origins.
  "x-clerk-auth-message",
]);

/** The minimal shape of an authentication outcome that the answer is built from. */
export interface AnswerSource {
  readonly status: "signed-in" | "signed-out" | "handshake";
  readonly headers: Headers;
}

/**
 * The headers of Clerk's answer that may be sent to the browser (see {@link WITHHELD}). Every
 * `set-cookie` is kept, each as its own header.
 *
 * @param source The headers `@clerk/backend` returned with the request state.
 * @returns A new `Headers` object.
 * @internal
 */
export function answerHeaders(source: Headers): Headers {
  const out = new Headers();
  for (const [name, value] of source) {
    if (name === "set-cookie") continue;
    if ((name === "location" || name.startsWith("x-clerk-")) && !WITHHELD.has(name)) {
      out.set(name, value);
    }
  }
  for (const cookie of source.getSetCookie()) out.append("set-cookie", cookie);
  return out;
}

/**
 * The redirect that starts or completes a handshake: a `307` to Clerk's handshake URL (the same method is
 * kept, so a POST is not turned into a GET), with `cache-control: no-store` and the cookies Clerk sets.
 * Returns `undefined` when the outcome is not a handshake or Clerk gave no location, so the caller treats
 * the request as signed out instead of answering nothing.
 *
 * @param auth The authentication outcome.
 * @returns The 307 response, or undefined.
 * @internal
 */
export function handshakeResponse(auth: AnswerSource): Response | undefined {
  if (auth.status !== "handshake") return undefined;
  const location = auth.headers.get("location");
  if (location === null) return undefined;
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of auth.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status: 307, headers });
}

/**
 * Adds Clerk's headers (the `x-clerk-*` status and the cookies of a refresh) to the response the inner
 * handlers made. A response whose headers are immutable is copied; a response with nothing to add is
 * returned as it is.
 *
 * @param response The response of the inner middleware or handler.
 * @param answer The answer headers (see {@link answerHeaders}).
 * @returns The response to send.
 * @internal
 */
export function withAnswerHeaders(response: Response, answer: Headers): Response {
  const cookies = answer.getSetCookie();
  const extra: Array<[string, string]> = [];
  for (const [name, value] of answer) {
    if (name !== "set-cookie" && name.startsWith("x-clerk-")) extra.push([name, value]);
  }
  if (cookies.length === 0 && extra.length === 0) return response;
  const out = new Response(response.body, response);
  for (const [name, value] of extra) out.headers.set(name, value);
  for (const cookie of cookies) out.headers.append("set-cookie", cookie);
  return out;
}
