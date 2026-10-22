import type { ClerkPricingTableOptions } from "../types";
import { mountClerkUi } from "./mount";

/**
 * Props of {@link PricingTable}. Every key except `children` is forwarded to Clerk's `mountPricingTable` call, and a
 * change of a prop mounts again with the new options. See {@link ClerkPricingTableOptions} for the named keys.
 * @since 1.0.0
 */
export type PricingTableProps = ClerkPricingTableOptions;

/**
 * Mounts Clerk's pricing table (the plans, with checkout for each) into a `<div>`. Props are forwarded to
 * `clerk.mountPricingTable()`. Clerk mounts into it once it has loaded; a change of a prop mounts again on the same
 * node, and removing the component unmounts it once. Plans and checkout need billing enabled in the Clerk dashboard.
 *
 * @param props See {@link PricingTableProps}.
 * @returns The `<div>` that hosts the table. On the server, an empty `<div>` with a hydration key, which the browser
 *   claims; Clerk's markup is never rendered on the server.
 * @throws Error `PricingTable must be used inside <ClerkProvider>.` when rendered outside a `ClerkProvider`.
 * @example
 * ```tsx
 * import { PricingTable } from "@shadow-js/clerk";
 *
 * export function PricingPage() {
 *   return <PricingTable for="organization" highlightedPlan="pro" />;
 * }
 * ```
 * @since 1.0.0
 */
export function PricingTable(props: PricingTableProps): unknown {
  return mountClerkUi("PricingTable", props, {
    mount: (clerk, node, options) => clerk.mountPricingTable(node, options),
    unmount: (clerk, node) => clerk.unmountPricingTable(node),
  });
}
