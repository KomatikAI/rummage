# Known gaps

Open items carried out of the build lanes, in the order they bite during a demo. Each one says
who closes it and where.

## Before the first sandbox run

- **The SQL has never run.** The three migrations and `supabase/seed.sql` were self-reviewed only.
  First spike step: `supabase link`, `supabase db push`, load the seed, replace the three
  `SANDBOX_SELLER_*` merchant ids and set `organizer_merchant_id`. See `supabase/README.md`.
- **No scheduled release of expired holds.** `release_expired_holds()` runs only from the organizer
  dashboard button. Add a cron line (the README has it) once the project exists.
- **Seed sale does not accept donations.** `accepts_donations` is false in the seed, so the cart shows
  "not open yet" instead of the donation picker. Flip it after the organizer PayPal link is ready.

## Checkout

- **A declined capture retried with the same request id** may return PayPal's cached error. Fix:
  derive the request id from cart id plus attempt count.
- **Refunded items stay `sold`.** Nothing relists them.
- **Organizers cannot list payments.** They have no row access to `purchase_units`, so the orders
  page shows per-household totals from the summary and refunds take a transaction id typed in from a
  receipt. A view scoped to the organizer's sale would close this.

## Seller

- **The prohibited-item check runs only in the browser.** Sellers cannot write the flag column, so a
  seller who skips "Price it" and fills the form by hand is never checked. Fix: run the check in the
  listing server action too.
- **Pickup codes are matched against every paid item** of the household, because
  `mark_item_collected` takes an item id. Harmless at demo scale.

## Organizer

- **No pending PayPal state on `sales`.** `organizer_merchant_id` is written only once PayPal reports
  the account ready; a half-finished link shows as unlinked.
- **"Release expired holds now" releases every sale's holds**, because the function is global and runs
  with the service role after an organizer check.

## Assistant

- **The organizer assistant keeps only the latest message per turn.** Its runner takes one question and
  does not stream.
- **The PayPal read-only tools attach only when the PayPal env vars are set**, and the whole env is
  validated at once, so in practice the organizer assistant needs the full `.env.local`.

## Schema wishes not yet acted on

- A "scheduled" sale state (open for holds before sale day) if the product wants it.
- PayPal OAuth scopes stored per household (only the two readiness flags are kept).
