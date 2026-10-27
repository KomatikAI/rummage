/**
 * The PayPal Agent Toolkit actions the organizer assistant may use, and the
 * tool names the toolkit gives them. All three are reads. Kept apart from the
 * adapter so importing the allowlist does not load the toolkit.
 *
 * transactions.list -> list_transactions
 * orders.get        -> get_order
 * payments.getRefunds -> get_refund
 */
export const ORGANIZER_PAYPAL_ACTIONS = {
  transactions: { list: true },
  orders: { get: true },
  payments: { getRefunds: true },
} as const satisfies Record<string, Record<string, boolean>>;

export const ORGANIZER_PAYPAL_TOOL_NAMES = [
  "list_transactions",
  "get_order",
  "get_refund",
] as const;
