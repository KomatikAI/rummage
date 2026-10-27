# Rummage database

Postgres schema, RLS policies, RPC functions and storage for Rummage, managed as Supabase migrations.

| File | What it does |
|---|---|
| `migrations/20261027120000_init.sql` | Tables, indexes, triggers, RLS (enabled and forced on every table), public views, RPC functions |
| `migrations/20261027120100_storage_item_photos.sql` | The `item-photos` storage bucket and its upload policies |
| `seed.sql` | Fictional demo sale in Forest Park, St. Louis: 6 households, 40 items |

The TypeScript side lives in `lib/supabase/` (`types.ts` mirrors the SQL; `schema-sync.test.ts` fails when the two drift).

## Apply the migrations to a fresh project

### Option A: Supabase CLI

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

`db push` applies every file in `supabase/migrations/` that the project has not run yet, in filename order.

### Option B: SQL editor

Open the project's SQL editor and run the two migration files in filename order: first `20261027120000_init.sql`, then `20261027120100_storage_item_photos.sql`. Run each file once.

The migrations must run as the `postgres` role (the CLI and the SQL editor both do). The SECURITY DEFINER functions rely on that role bypassing RLS, and the init migration stops with an error if the role cannot.

## Load the seed

Run the seed after the migrations:

- **CLI:** `supabase db push --include-seed`. Or run the file directly: `psql "<connection string>" -f supabase/seed.sql`
- **SQL editor:** paste `seed.sql` and run it.
- **Local stack:** `supabase start` (after `supabase init`) applies the migrations and `supabase/seed.sql` automatically.

The seed is idempotent: it uses fixed ids and `on conflict do nothing`, so running it again changes nothing.

Everything in the seed is fictional. All household pins sit on paths inside Forest Park, a public park, and none on a residential parcel. The seed does not attach owner accounts: `sales.organizer_user_id` and `households.owner_user_id` stay null until the account script links the judges' sandbox users.

### Replace the placeholder merchant ids

Three seeded households are marked `ready` with the placeholder merchant ids `SANDBOX_SELLER_1`, `SANDBOX_SELLER_2` and `SANDBOX_SELLER_3`. PayPal rejects an order that names a placeholder payee, so replace them before the first checkout:

1. Onboard three PayPal sandbox business accounts through the seller onboarding flow (Partner Referrals). For each account, note its `merchantIdInPayPal` from the onboarding return URL or from the merchant-integration status call.
2. Run the update with the service role (SQL editor or `psql`):

   ```sql
   update public.households set merchant_id_in_paypal = '<sandbox merchant id 1>'
    where id = 'b0000000-0000-4000-8000-000000000001';  -- The Alvarez table
   update public.households set merchant_id_in_paypal = '<sandbox merchant id 2>'
    where id = 'b0000000-0000-4000-8000-000000000002';  -- Oak corner
   update public.households set merchant_id_in_paypal = '<sandbox merchant id 3>'
    where id = 'b0000000-0000-4000-8000-000000000003';  -- The Lindqvist stall
   ```

3. To offer the PTA donation unit, onboard the organizer's sandbox account the same way and set its id:

   ```sql
   update public.sales set organizer_merchant_id = '<sandbox organizer merchant id>'
    where id = 'a0000000-0000-4000-8000-000000000001';
   ```

Until step 3 is done, `public_sales.accepts_donations` is false.

## Storage

The bucket `item-photos` is public-read: anyone can load a photo by its public URL. Each file is limited to 10 MB and must be JPEG, PNG, WebP or HEIC.

- A signed-in seller can upload, replace and delete files only under `households/<household_id>/...`, and only for a household they own.
- Seed photos go under `seed/<slug>.jpg`. Upload them with the service role key, for example from a script that uses `lib/supabase/admin.ts`. Client policies do not cover the `seed/` prefix.
- `items.photo_path` stores the path inside the bucket. The public URL is `<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/item-photos/<photo_path>`, or `supabase.storage.from("item-photos").getPublicUrl(photo_path)`.

## Expiring holds

`hold_item` holds an item for 15 minutes. Run `public.release_expired_holds()` every minute with the service role. It returns expired holds in open carts to `listed`. It abandons checkout carts that have not been touched for 3 hours and returns their items to `listed`. It also relists orphaned holds. With `pg_cron` enabled:

```sql
select cron.schedule('rummage-release-expired-holds', '* * * * *',
  $$select public.release_expired_holds()$$);
```

You can also call it from a server route or Vercel cron through the admin client: `admin.rpc("release_expired_holds")`.

## Access model

| Who | Can |
|---|---|
| Anyone (anon or signed in) | Read `public_sales` and `public_listings`. These views show jittered `public_lng`/`public_lat` only, never `exact_*` |
| Organizer | Create a sale and update their own; read its households and items; read money totals only through `organizer_sale_summary(p_sale)` |
| Seller | Join a sale with `join_sale(invite_token, label)`; read, update (`label`, `exact_*`, `paused`) and delete their own household; create, read, update and delete its items. Items in `held`, `sold` or `collected` are locked. Sellers read their household's `purchase_units` without `pickup_code`, and confirm a pickup with `mark_item_collected(item, code)` |
| Buyer | Create their own cart; hold and release items only through `hold_item` and `release_hold`; read their own carts, lines and purchase units (without `pickup_code`); get exact locations and pickup codes only through `get_my_pickups()`, and only for captures that are `COMPLETED` |
| Service role | Everything else: PayPal order creation, captures (`mark_units_captured`), refunds, webhook events, PayPal onboarding status, moderation flags |

Client roles have column-level grants on `purchase_units`. A client `select("*")` on that table fails, so list the columns, as `PURCHASE_UNIT_CLIENT_COLUMNS` in `lib/supabase/types.ts` does.

### Household cap (PayPal's 10 purchase units)

PayPal Orders v2 allows up to 10 purchase units per order. Rummage uses one unit per household and, at a fundraiser, one donation unit. When `sales.fundraiser_name` is set, `hold_item` always reserves the donation unit, so a cart holds items from at most 9 households. The unit stays reserved even if the buyer gives nothing. Without a fundraiser the cap is 10. Reserving the unit up front keeps the cap predictable, so checkout never fails late. `maxHouseholdsPerCart()` in `lib/supabase/types.ts` mirrors this rule for the UI.

## Contract for the checkout and webhook code

1. **Before redirecting the buyer to PayPal:** set `carts.status = 'checkout'` and `paypal_order_id`. Insert one `purchase_units` row per household, plus the donation row with `household_id = null`. Each row carries `reference_id`, `amount` and `merchant_id`, matching the order's purchase units. Holds on a checkout cart are kept for up to 3 hours.
2. **On capture (from the capture response and again from the webhook):** call `mark_units_captured(cart_id, [{reference_id, capture_id, capture_status, seller_receivable}, ...])`. The call is idempotent. For each `COMPLETED` unit it generates the pickup code and marks that household's items `sold`. For each `DECLINED` or `FAILED` unit it releases that household's holds. It then sets the cart to `paid`, `partial` or `failed`. A `PENDING` unit keeps its holds until a later call settles it.
3. **Refunds:** update `refund_id` and `refund_status` on the unit with the service role. When the refund completes, set `capture_status` to the PayPal capture status (`REFUNDED` or `PARTIALLY_REFUNDED`). The buyer's pickup row then disappears, because `get_my_pickups` only returns `COMPLETED` captures.
4. **Webhooks:** call `recordPayPalEvent(event)` first. It returns false for an `event_id` that is already stored, so retried deliveries are skipped. Set `processed_at` once the event is handled.
