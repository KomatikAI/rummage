/**
 * The PayPal Agent Toolkit actions the organizer assistant may use, and the
 * tool names the toolkit gives them. Both are reads, and both take one id that
 * lib/ai/paypal-sale-scope.ts checks against the organizer's own sale before
 * the call. `transactions.list` is left out on purpose: the tools run with the
 * platform credentials and a transaction list cannot be filtered to one sale.
 * Kept apart from the adapter so importing the allowlist does not load the toolkit.
 *
 * orders.get          -> get_order
 * payments.getRefunds -> get_refund
 */
export const ORGANIZER_PAYPAL_ACTIONS = {
  orders: { get: true },
  payments: { getRefunds: true },
} as const satisfies Record<string, Record<string, boolean>>;

export const ORGANIZER_PAYPAL_TOOL_NAMES = ["get_order", "get_refund"] as const;
