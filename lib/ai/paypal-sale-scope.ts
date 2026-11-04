import type { Tool } from "ai";

/**
 * Narrows the organizer's PayPal tools to one sale. The toolkit's tools run with the
 * platform's own credentials, so without this an organizer could read any order or
 * refund on the platform account, and every transaction, not just their sale's.
 *
 * - `get_order` answers only for order ids among the sale's carts.
 * - `get_refund` answers only for refund ids among the sale's purchase units.
 * - Anything else (`list_transactions` above all, which has no per-sale filter) is dropped.
 *
 * An id outside the sale gets a tool result saying so rather than an exception, so the
 * model tells the organizer instead of the request failing.
 */

export interface SalePayPalIds {
  orderIds: ReadonlySet<string>;
  refundIds: ReadonlySet<string>;
}

export const NOT_THIS_SALE = {
  error: "not_this_sale",
  message: "That id does not belong to this sale, so it cannot be looked up here.",
} as const;

/** The input field each scoped tool is keyed on (the toolkit's parameter names). */
const ID_FIELD: Record<string, { field: string; ids: keyof SalePayPalIds }> = {
  get_order: { field: "id", ids: "orderIds" },
  get_refund: { field: "refund_id", ids: "refundIds" },
};

function idFrom(input: unknown, field: string): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

export function scopePayPalToolsToSale(tools: Record<string, Tool>, sale: SalePayPalIds): Record<string, Tool> {
  const scoped: Record<string, Tool> = {};
  for (const [name, original] of Object.entries(tools)) {
    const rule = ID_FIELD[name];
    const execute = original.execute;
    if (!rule || !execute) continue;
    const allowed = sale[rule.ids];
    scoped[name] = {
      ...original,
      execute: async (input, options) => {
        const id = idFrom(input, rule.field);
        if (id === null || !allowed.has(id)) return NOT_THIS_SALE;
        return execute.call(original, input, options);
      },
    } as Tool;
  }
  return scoped;
}
