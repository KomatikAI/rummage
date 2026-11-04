-- Rummage: positive prices and a narrower sales read grant.
--
-- 1. A price of $0.00 passed every check (price >= 0, items_priced_when_public, the
--    price-is-null test in hold_item), so a free item could be listed, held and sent to
--    PayPal as a zero-amount purchase unit. A price is now strictly positive. The seller
--    form refuses 0 too (components/seller/forms.ts), so the constraint is the backstop.
--
-- 2. Sellers could read every column of their sale through sales_select_organizer_or_member,
--    including invite_token (which lets anyone join the sale as a seller and hand it on)
--    and organizer_merchant_id. The table-level select grant is replaced by a column list
--    that leaves those two out. Nothing a seller or buyer does needs them: join_sale takes
--    the token the organizer shared, and the organizer page reads both columns through the
--    admin client after its RLS check (app/organizer/[saleId]/data.ts). public_sales is
--    security definer and never exposed them.
--
-- Security posture: client grants narrow; RLS stays enabled and forced.

-- ---------------------------------------------------------------------------
-- 1. items.price > 0
-- ---------------------------------------------------------------------------

alter table public.items
  add constraint items_price_positive check (price is null or price > 0);

-- ---------------------------------------------------------------------------
-- 2. sales: column-level select for clients
-- ---------------------------------------------------------------------------

revoke select on public.sales from authenticated;
grant select (
  id, organizer_user_id, name, slug, description, sale_date, starts_at, ends_at,
  area_lng, area_lat, area_radius_m, fundraiser_name, fundraiser_goal, status, created_at
) on public.sales to authenticated;
