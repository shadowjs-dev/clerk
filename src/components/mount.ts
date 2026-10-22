import { isServer, onCleanup, useEffect } from "@shadow-js/core";
import { readOptions } from "../internal/actions";
import { type ClerkContextValue, requireContext } from "../internal/context";
import { clientPlaceholder, serverPlaceholder } from "../internal/placeholder";
import type { ClerkLike, ClerkUiOptions } from "../types";

/**
 * How one Clerk UI component is mounted and unmounted. Each entry calls the matching
 * `mountX` / `unmountX` pair of the SDK.
 * @internal
 */
export interface MountSpec {
  readonly mount: (clerk: ClerkLike, node: HTMLDivElement, options: ClerkUiOptions) => void;
  readonly unmount: (clerk: ClerkLike, node: HTMLDivElement) => void;
}

/**
 * Creates the `<div>` a Clerk UI component renders into and keeps it mounted for the owner's
 * lifetime. The node is attached by the parent before the effect runs, which is when Clerk can
 * mount into it. Each change of a prop calls `mountX` again on the same node, which Clerk treats
 * as an update. Disposal (or removal by a conditional) unmounts once.
 *
 * On the server the component renders an empty `<div>` with a hydration key (see
 * `internal/placeholder.ts`), so the browser claims that element instead of creating a new one.
 *
 * @param name Component name, used in the error when no provider exists.
 * @param props The component's props. Every key except `children` is forwarded to Clerk.
 * @param spec The mount and unmount calls.
 * @returns The node to insert: the server placeholder on the server, the claimed or new `<div>` in the browser.
 * @internal
 */
export function mountClerkUi(name: string, props: object, spec: MountSpec): unknown {
  const ctx: ClerkContextValue = requireContext(name);
  if (isServer) return serverPlaceholder();
  const node = clientPlaceholder("div");
  let mountedWith: ClerkLike | null = null;

  useEffect(() => {
    const clerk = ctx.clerk();
    if (clerk === null) return;
    const options: ClerkUiOptions = readOptions(props, []);
    // Only a node that Clerk has mounted into is recorded: a mount that throws (for example, an older clerk-js
    // without the method) must not be unmounted later. A replaced instance is cleared before its unmount runs.
    if (mountedWith !== null && mountedWith !== clerk) {
      const previous = mountedWith;
      mountedWith = null;
      spec.unmount(previous, node);
    }
    spec.mount(clerk, node, options);
    mountedWith = clerk;
  });

  onCleanup(() => {
    if (mountedWith !== null) spec.unmount(mountedWith, node);
    mountedWith = null;
  });
  return node;
}
