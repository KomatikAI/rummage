# Known gaps

Open items carried out of the build lanes, in the order they bite during a demo. Each one says
who closes it and where.

## Before the first sandbox run

- **The SQL has never run.** The four migrations and `supabase/seed.sql` were self-reviewed only.
  First spike step: `supabase link`, `supabase db push`, load the seed, replace the three
  `SANDBOX_SELLER_*` merchant ids and set `organizer_merchant_id`. See `supabase/README.md`.
- **No scheduled release of expired holds.** `release_expired_holds()` runs only from the organizer
  dashboard button. Add a cron line (the README has it) once the project exists.

## Checkout

- **Refunded items stay `sold`.** Nothing relists them.
- **Organizers cannot list payments.** They have no row access to `purchase_units`, so the orders
  page shows per-household totals from the summary and refunds take a transaction id typed in from a
  receipt. A view scoped to the organizer's sale would close this.

## Seller

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

## Scan

- **Not tracked AR.** Each scan is one still frame. The price sticker is placed once from the box the
  model returns and does not follow the item when the phone moves; the next scan places it again.
- **Placement is coarse.** The box is the model's estimate, mapped through the video's `object-cover`
  crop. The sticker sits below the item, above it, or over its centre, clamped to the screen, and can
  land a little off.
- **The rate limit is per server instance.** It is an in-memory map (one scan per 1.2 s, 60 per 10
  minutes per user), so several instances each allow that much. A shared store would close this.
- **Never tried on a real phone or against the real API.** Every test uses a fake model client and a
  fake database. Camera start, the photo fallback and the model's boxes are untested on hardware.
- **Listing photos must be publicly reachable.** Candidate photos are sent as URL image blocks, which
  the API fetches itself. Photos served by a local Supabase (`127.0.0.1`) cannot be fetched, so local
  scans match on titles and descriptions only, and usually miss. Use the hosted project.
- **One very full table is cut to 24 items**, available ones first. Items past that cannot be matched.

## Schema wishes not yet acted on

- A "scheduled" sale state (open for holds before sale day) if the product wants it.
- PayPal OAuth scopes stored per household (only the two readiness flags are kept).
