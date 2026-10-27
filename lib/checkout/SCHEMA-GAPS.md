# Checkout schema gaps (lane E)

Where the schema has no column for something, the PayPal routes use the closest
existing one, as listed below. Seller readiness flags were added in
`supabase/migrations/20261028090000_schema_gaps.sql`; the rest need no SQL
unless the product changes.

## 1. Order id and unit status

`purchase_units` has no PayPal order id and no status column.

- The order id is stored once per cart in `carts.paypal_order_id`, so a cart
  has one order. Capture and webhook lookups go from the order to the cart and
  then to its units.
- A unit counts as pending while `capture_status` is null. After that it holds
  PayPal's capture status (COMPLETED, PENDING, DECLINED, FAILED), or REFUNDED /
  PARTIALLY_REFUNDED once a refund completes.

No SQL is needed unless one cart must be able to hold several orders.

## 2. Seller readiness: OAuth scopes not recorded

`households.paypal_payments_receivable` and `paypal_email_confirmed` (migration
`20261028090000_schema_gaps.sql`) now keep the two flags behind `paypal_status`.
The payment and refund OAuth scope checks that `readyToSell` also makes are
still not stored, and `paypal_status` does not depend on them. Two more
nullable boolean columns would close this if the status should require them.

## 3. Referral tracking id

The referral reuses `households.tracking_id`, which is unique and has a uuid
default, so no new column is needed. The partner-return route checks it, and
so does the `MERCHANT.ONBOARDING.COMPLETED` handler.

## 4. Refund payee

A refund is made against `purchase_units.merchant_id`, the payee when the
order was created, rather than the household's current `merchant_id_in_paypal`.
That way a seller who relinks PayPal after a sale still refunds from the
account that was paid.
