import { type RenderResult, render } from "@shadow-js/testing/dom";
import { type ClerkLike, type ClerkLoadOptions, ClerkProvider } from "../../src/index";

/** A publishable key of the documented shape. It is never sent anywhere by the tests. */
export const KEY = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";
export const LIVE_KEY = "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k";

/** Options of {@link mountProvider}. */
export interface MountOptions {
  readonly clerk?: ClerkLike;
  readonly loadOptions?: ClerkLoadOptions;
  readonly publishableKey?: string;
}

/**
 * Mounts a provider around the text "app". `read` runs once inside the provider's scope, the way
 * children run in a real tree, so hooks it calls see the context. Its result is returned, and the
 * render result can be disposed by the test.
 */
export function mountProvider<T>(
  read: () => T,
  options: MountOptions = {},
): { readonly value: T; readonly view: RenderResult } {
  const box: { value: T | undefined; reads: number } = { value: undefined, reads: 0 };
  const view = render(() =>
    ClerkProvider({
      publishableKey: options.publishableKey ?? KEY,
      ...(options.clerk === undefined ? {} : { clerk: options.clerk }),
      ...(options.loadOptions === undefined ? {} : { loadOptions: options.loadOptions }),
      get children() {
        box.reads += 1;
        box.value = read();
        return "app";
      },
    }),
  );
  if (box.value === undefined) throw new Error("mountProvider: read() did not run");
  return { value: box.value, view };
}
