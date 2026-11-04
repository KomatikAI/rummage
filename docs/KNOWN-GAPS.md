# Known gaps

Open items carried out of the build lanes, in the order they bite during a demo. Each one says
who closes it and where.

## Before the first sandbox run

- **PayPal merchant ids are still placeholders.** All seven migrations and `supabase/seed.sql`
  were applied to the hosted Supabase project on 2026-11-04 (every statement ran clean; `pg_cron`
  installed and the minute sweep is scheduled). The three linked seed households still carry
  `SANDBOX_SELLER_1..3` and `sales.organizer_merchant_id` is null until the sandbox seller
  accounts exist. See `supabase/README.md` for the update statements.
- **Scheduled release of expired holds runs on `pg_cron`.** The hosted project has the
  `rummage-release-expired-holds` job every minute. `hold_item` also frees an expired hold on the
  item it is asked for, and create-order runs the sweep before it claims a cart, so an expired
  line is never charged. A project without `pg_cron` needs the cron line from the README another
  way.

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
- **The PayPal read-only tools attach only when the PayPal env vars are set.** The env is validated
  per group (`ENV_GROUPS` in `lib/env.ts`), so a page that only reads Supabase renders without the
  PayPal or Anthropic keys; the organizer assistant itself still needs the PayPal group to show
  order and refund data.

## Scan

- **Not tracked AR.** Each scan is one still frame. The price sticker is placed once from the box the
  model returns and does not follow the item when the phone moves; the next scan places it again.
- **Placement is coarse.** The box is the model's estimate, mapped through the video's `object-cover`
  crop. The sticker sits below the item, above it, or over its centre, clamped to the screen, and can
  land a little off.
- **The rate limits are per server instance.** Scan, pricing and the shopping assistant share an
  in-memory limiter in `lib/rate-limit.ts` (one scan per 1.2 s, 60 per 10
  minutes per user), so several instances each allow that much. A shared store would close this.
- **Never tried on a real phone or against the real API.** Every test uses a fake model client and a
  fake database. Camera start, the photo fallback and the model's boxes are untested on hardware.
- **Listing photos must be publicly reachable.** Candidate photos are sent as URL image blocks, which
  the API fetches itself. Photos served by a local Supabase (`127.0.0.1`) cannot be fetched, so local
  scans match on titles and descriptions only, and usually miss. Use the hosted project.
- **One very full table is cut to 24 items**, available ones first. Items past that cannot be matched.

## Dependencies

- **`npm audit` reports high findings inside `@paypal/agent-toolkit`.** Version 1.11.0 (the latest)
  pins its own `ai@4`, `zod@3`, `openai@4`, `mathjs`, `uuid@10` and `@langchain/core`, and the
  advisories are against those nested copies, not the app's `ai@7` and `zod@4`. `npm audit fix
  --force` would downgrade the toolkit to 1.3.5, which predates the actions this app uses. The
  toolkit is loaded only by the organizer assistant, only when the PayPal env vars are set, and
  only its two read actions are exposed (`lib/ai/paypal-readonly.ts`). Re-run the audit when the
  toolkit publishes a release on current dependencies.

## Schema wishes not yet acted on

- A "scheduled" sale state (open for holds before sale day) if the product wants it.
- PayPal OAuth scopes stored per household (only the two readiness flags are kept).
