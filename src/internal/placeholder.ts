import { claimElement, nextKey } from "@shadow-js/web/extend";
import { escape as escapeText, ssrHydrationKey, ssrRaw } from "@shadow-js/web/server";

/*
 * Server placeholders for the Clerk UI. Clerk renders into an element the browser creates, so the
 * server sends an empty element with a hydration key, and the browser claims that element. Both
 * sides take their key at the same point of the render, so the sequence of keys stays the same and
 * hydration finds the element instead of reporting a missing key.
 */

/**
 * The server markup of an empty `<div>` that takes the next hydration key. Only called on the server.
 * @internal
 */
export function serverPlaceholder(): unknown {
  return ssrRaw(`<div${ssrHydrationKey()}></div>`);
}

/**
 * The server markup of a `<button>` with the given text, taking the next hydration key. Only called
 * on the server.
 * @internal
 */
export function serverButton(text: string): unknown {
  return ssrRaw(`<button type="button"${ssrHydrationKey()}>${escapeText(text)}</button>`);
}

/** The element each placeholder tag produces in the browser. @internal */
interface PlaceholderElements {
  readonly div: HTMLDivElement;
  readonly button: HTMLButtonElement;
}

/**
 * The element for the next placeholder: the server's element while the page hydrates (the same key
 * position), otherwise a new one. Only called in the browser.
 * @internal
 */
export function clientPlaceholder<Tag extends keyof PlaceholderElements>(
  tag: Tag,
): PlaceholderElements[Tag] {
  const claimed = claimElement(nextKey());
  if (claimed instanceof HTMLElement && claimed.localName === tag) {
    return claimed as PlaceholderElements[Tag];
  }
  return document.createElement(tag) as PlaceholderElements[Tag];
}
