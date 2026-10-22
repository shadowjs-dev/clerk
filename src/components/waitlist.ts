import type { ClerkWaitlistOptions } from "../types";
import { mountClerkUi } from "./mount";

/**
 * Props of {@link Waitlist}. Every key except `children` is forwarded to Clerk's `mountWaitlist` call, and a change of a
 * prop mounts again with the new options. See {@link ClerkWaitlistOptions} for the named keys.
 * @since 1.0.0
 */
export type WaitlistProps = ClerkWaitlistOptions;

/**
 * Mounts Clerk's waitlist form, where a visitor asks to join before sign-up is open, into a `<div>`. Props are
 * forwarded to `clerk.mountWaitlist()`. Clerk mounts into it once it has loaded; a change of a prop mounts again on the
 * same node, and removing the component unmounts it once.
 *
 * @param props See {@link WaitlistProps}.
 * @returns The `<div>` that hosts the form. On the server, an empty `<div>` with a hydration key, which the browser
 *   claims; Clerk's markup is never rendered on the server.
 * @throws Error `Waitlist must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { Waitlist } from "@shadow-js/clerk";
 *
 * export function JoinPage() {
 *   return <Waitlist afterJoinWaitlistUrl="/thanks" signInUrl="/sign-in" />;
 * }
 * ```
 * @since 1.0.0
 */
export function Waitlist(props: WaitlistProps): unknown {
  return mountClerkUi("Waitlist", props, {
    mount: (clerk, node, options) => clerk.mountWaitlist(node, options),
    unmount: (clerk, node) => clerk.unmountWaitlist(node),
  });
}
