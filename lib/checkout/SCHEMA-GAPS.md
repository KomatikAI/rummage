# Checkout schema gaps (lane E)

The PayPal routes run on the existing migration unchanged. Where it has no
column for something, the routes use the closest existing one, as listed below.
The SQL shown is the smallest change that would close each gap. It has not been
applied: the migration was left untouched.

## 1. Order id and unit status

`purchase_units` has no PayPal order id and no status column.

- The order id is stored once per cart in `carts.paypal_order_id`, so a cart
  has one order. Capture and webhook lookups go from the order to the cart and
  then to its units.
- A unit counts as pending while `capture_status` is null. After that it holds
  PayPal's capture status (COMPLETED, PENDING, DECLINED, FAILED), or REFUNDED /
  PARTIALLY_REFUNDED once a refund completes.

No SQL is needed unless one cart must be able to hold several orders.

## 2. Seller readiness detail

`households` keeps readiness as `paypal_status` (unlinked, pending, ready,
revoked) plus `paypal_checked_at`. A household is set to `ready` only when
PayPal reports both `payments_receivable` and `primary_email_confirmed`.
Otherwise it is set to `pending`. The two flags are not kept separately, and
the OAuth scope checks that `readyToSell` also makes are not recorded.

Proposed SQL:

    alter table public.households
      add column paypal_payments_receivable boolean,
      add column paypal_email_confirmed boolean;

The same change would need to go into `lib/supabase/types.ts` and the
schema-sync test.

## 3. Referral tracking id

The referral reuses `households.tracking_id`, which is unique and has a uuid
default, so no new column is needed. The partner-return route checks it, and
so does the `MERCHANT.ONBOARDING.COMPLETED` handler.

## 4. Refund payee

A refund is made against `purchase_units.merchant_id`, the payee when the
order was created, rather than the household's current `merchant_id_in_paypal`.
That way a seller who relinks PayPal after a sale still refunds from the
account that was paid.
