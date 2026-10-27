# Schema gaps found while wiring lib/repos (lane F)

The paid order count, the fundraiser goal and the text results of `hold_item` / `release_hold` landed in `supabase/migrations/20261028090000_schema_gaps.sql`. One gap is still open.

## `SaleSummary.status` "scheduled" has no database state

`sales.status` is `draft | open | closed`; the repo maps `open -> live`, `closed -> ended`, and never returns `scheduled`. If "open for holds but before the sale day" should read as scheduled, no SQL is needed: derive it from `sale_date > current_date` in the repo. Left as is until the product says which it means.
