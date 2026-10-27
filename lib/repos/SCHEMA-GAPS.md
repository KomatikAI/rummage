# Schema gaps found while wiring lib/repos (lane F)

The repos code against `supabase/migrations/20261027120000_init.sql` as it is. Each gap below says what the repo does today and the smallest SQL that would close it. None of this has been applied.

## 1. `FundraiserTotal.paidOrderCount` has no organizer-readable source

Organizers have no row access to `carts` or `purchase_units`, and `organizer_sale_summary` does not count orders. `SupabaseSaleReadRepo.fundraiserTotal` returns `0` today and reads `paid_order_count` from the summary as soon as it exists (the zod schema already accepts it).

Add one key to the `jsonb_build_object(...)` in `organizer_sale_summary`:

```sql
'paid_order_count', (
  select count(*) from public.carts c
  where c.sale_id = p_sale and c.status in ('paid', 'partial')
),
```

## 2. `FundraiserTotal.goal` has no column

`goal` is always `null`.

```sql
alter table public.sales
  add column fundraiser_goal numeric(10, 2) check (fundraiser_goal is null or fundraiser_goal >= 0);
grant insert (fundraiser_goal), update (fundraiser_goal) on public.sales to authenticated;
```

Then add `'fundraiser_goal', (select s.fundraiser_goal from public.sales s where s.id = p_sale)` to the summary (or read it from `sales` in the repo; organizers can already select their sale).

## 3. `SaleSummary.status` "scheduled" has no database state

`sales.status` is `draft | open | closed`; the repo maps `open -> live`, `closed -> ended`, and never returns `scheduled`. If "open for holds but before the sale day" should read as scheduled, no SQL is needed: derive it from `sale_date > current_date` in the repo. Left as is until the product says which it means.

## 4. `hold_item` / `release_hold` return a bare boolean

Both functions return `false` for every refusal, so the repo re-reads `public_listings` (and the caller's `cart_lines`) to choose `not_found | already_held | sold | not_allowed`. That costs one or two extra reads per refusal and cannot tell the `not_allowed` causes apart (household cap, PayPal not ready, own item, cart not open). A text return would remove both:

```sql
-- hold_item returns text: 'held' | 'not_found' | 'already_held' | 'sold' | 'not_allowed'
-- (same body, each `return false` replaced by the matching reason, `return true` by 'held')
```

This changes the function's return type, so it is a `drop function` + `create function` + re-grant, and `lib/supabase/types.ts` must follow.
