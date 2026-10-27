-- Rummage: close the schema gaps recorded by the repos and checkout lanes.
--
--   1. organizer_sale_summary() also returns paid_order_count (paid or partial carts in
--      the sale) and fundraiser_goal.
--   2. sales.fundraiser_goal: an optional donation goal the organizer sets. Exposed in
--      public_sales next to fundraiser_name.
--   3. hold_item() and release_hold() return a text reason instead of a bare boolean, so
--      callers no longer re-read public_listings to explain a refusal.
--   4. households.paypal_payments_receivable / paypal_email_confirmed: the two PayPal
--      onboarding flags behind paypal_status, kept separately (null = never checked).
--      Written by the service role only.
--
-- Security posture is unchanged from the init migration: every SECURITY DEFINER function
-- is recreated with `set search_path = ''` and followed by REVOKE ALL ... FROM PUBLIC,
-- anon, authenticated and the same narrow GRANT EXECUTE. hold_item and release_hold change
-- return type, so they are dropped and recreated, and a new function gets PUBLIC execute
-- by default, which is why the revoke is re-issued here. RLS stays enabled and forced; no
-- policy changes.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.sales
  add column if not exists fundraiser_goal numeric(10, 2)
    check (fundraiser_goal is null or fundraiser_goal >= 0);

-- The organizer sets the goal when creating or editing the sale (sales_insert_own /
-- sales_update_own already limit the rows). Column grants add to the init grants.
grant insert (fundraiser_goal), update (fundraiser_goal) on public.sales to authenticated;

-- Both flags come from PayPal's merchant-integration status call. paypal_status is
-- 'ready' only when both are true. No client grant: the owner and the organizer read them
-- through the existing table-level select; only the service role writes them.
alter table public.households
  add column if not exists paypal_payments_receivable boolean,
  add column if not exists paypal_email_confirmed boolean;

-- ---------------------------------------------------------------------------
-- public_sales: append fundraiser_goal (create or replace view may only add columns at
-- the end, so the existing column order is kept exactly).
-- ---------------------------------------------------------------------------

create or replace view public.public_sales
with (security_invoker = false)
as
select
  s.id,
  s.slug,
  s.name,
  s.description,
  s.sale_date,
  s.starts_at,
  s.ends_at,
  s.area_lng,
  s.area_lat,
  s.area_radius_m,
  s.fundraiser_name,
  (s.organizer_merchant_id is not null) as accepts_donations,
  s.status,
  s.fundraiser_goal
from public.sales s
where s.status in ('open', 'closed');

revoke all on public.public_sales from public, anon, authenticated;
grant select on public.public_sales to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- hold_item: put a listed item in the caller's open cart for 15 minutes.
--
-- Household cap: PayPal Orders v2 allows at most 10 purchase units per order, one per
-- household plus (when the sale is a fundraiser) one donation unit to the organizer.
-- When sales.fundraiser_name is set we always reserve that unit, so the cap is
-- 9 households, even if the buyer later gives no donation; otherwise 10.
--
-- Returns (never raises for a refusal):
--   'held'             held, or already held in this cart (the hold is refreshed)
--   'not_allowed'      signed out, or the cart is missing or not the caller's, or the
--                      sale is no longer open
--   'cart_not_open'    the caller's cart is at checkout or finished
--   'not_found'        no such item, or it is not in public_listings for the cart's sale
--                      (other sale, unpublished, flagged, household paused)
--   'already_held'     in another buyer's cart
--   'sold'             already sold
--   'own_item'         the caller is the item's seller
--   'seller_not_ready' the household cannot take PayPal payments yet
--   'cap_reached'      the cart already has items from the maximum number of households
--
-- Lock order is unchanged (cart, then item), so concurrent holds cannot deadlock.
-- ---------------------------------------------------------------------------

drop function if exists public.hold_item(uuid, uuid);

create or replace function public.hold_item(p_item uuid, p_cart uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cart public.carts%rowtype;
  v_item public.items%rowtype;
  v_household public.households%rowtype;
  v_sale public.sales%rowtype;
  v_cap integer;
  v_households_in_cart integer;
begin
  if v_uid is null then
    return 'not_allowed';
  end if;

  -- Lock the cart so concurrent holds cannot both pass the household cap.
  select * into v_cart from public.carts c where c.id = p_cart for update;
  if not found or v_cart.buyer_user_id <> v_uid then
    return 'not_allowed';
  end if;
  if v_cart.status <> 'open' then
    return 'cart_not_open';
  end if;

  -- Already held in this cart: refresh the hold.
  if exists (
    select 1 from public.cart_lines cl
    where cl.cart_id = p_cart and cl.item_id = p_item and cl.active
  ) then
    update public.cart_lines
       set hold_expires_at = now() + interval '15 minutes'
     where cart_id = p_cart and item_id = p_item;
    return 'held';
  end if;

  select * into v_item from public.items i where i.id = p_item for update;
  if not found then
    return 'not_found';
  end if;

  select * into v_household from public.households h where h.id = v_item.household_id;
  select * into v_sale from public.sales s where s.id = v_household.sale_id;

  -- Same visibility as public_listings, limited to the cart's sale: anything the buyer
  -- cannot see there reads as not found, so no hidden item is revealed.
  if v_sale.id <> v_cart.sale_id
     or v_sale.status not in ('open', 'closed')
     or v_household.paused
     or v_item.prohibited_flag
     or v_item.status not in ('listed', 'held', 'sold') then
    return 'not_found';
  end if;

  if v_item.status = 'held' then
    return 'already_held';
  end if;
  if v_item.status = 'sold' then
    return 'sold';
  end if;

  -- Listed from here on. items_priced_when_public guarantees a price; keep the check.
  if v_item.price is null or v_sale.status <> 'open' then
    return 'not_allowed';
  end if;

  -- Sellers cannot buy their own items.
  if v_household.owner_user_id is not null and v_household.owner_user_id = v_uid then
    return 'own_item';
  end if;

  if v_household.paypal_status <> 'ready' or v_household.merchant_id_in_paypal is null then
    return 'seller_not_ready';
  end if;

  v_cap := case when v_sale.fundraiser_name is not null then 9 else 10 end;
  if not exists (
    select 1 from public.cart_lines cl
    where cl.cart_id = p_cart and cl.household_id = v_household.id and cl.active
  ) then
    select count(distinct cl.household_id) into v_households_in_cart
    from public.cart_lines cl
    where cl.cart_id = p_cart and cl.active;
    if v_households_in_cart >= v_cap then
      return 'cap_reached';
    end if;
  end if;

  -- The item row is locked above, so this only misses if the status changed under us.
  update public.items set status = 'held' where id = p_item and status = 'listed';
  if not found then
    return 'already_held';
  end if;

  insert into public.cart_lines (cart_id, item_id, household_id, price, hold_expires_at, active)
  values (p_cart, p_item, v_household.id, v_item.price, now() + interval '15 minutes', true);

  update public.carts set updated_at = now() where id = p_cart;
  return 'held';
end;
$$;

revoke all on function public.hold_item(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hold_item(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- release_hold: the buyer removes an item from their open cart.
--
-- Returns (never raises for a refusal):
--   'released'      the line is gone and the item is listed again
--   'not_allowed'   signed out, or the cart is missing or not the caller's
--   'cart_not_open' the caller's cart is at checkout or finished
--   'not_held'      the item is in public_listings for the cart's sale but not in this cart
--   'not_found'     no such item in public_listings for the cart's sale
-- ---------------------------------------------------------------------------

drop function if exists public.release_hold(uuid, uuid);

create or replace function public.release_hold(p_item uuid, p_cart uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cart public.carts%rowtype;
begin
  if v_uid is null then
    return 'not_allowed';
  end if;

  select * into v_cart from public.carts c where c.id = p_cart for update;
  if not found or v_cart.buyer_user_id <> v_uid then
    return 'not_allowed';
  end if;
  if v_cart.status <> 'open' then
    return 'cart_not_open';
  end if;

  delete from public.cart_lines cl
   where cl.cart_id = p_cart and cl.item_id = p_item and cl.active;
  if not found then
    -- Same visibility as public_listings, limited to the cart's sale.
    if exists (
      select 1
      from public.items i
      join public.households h on h.id = i.household_id
      join public.sales s on s.id = h.sale_id
      where i.id = p_item
        and s.id = v_cart.sale_id
        and s.status in ('open', 'closed')
        and h.paused = false
        and i.prohibited_flag = false
        and i.status in ('listed', 'held', 'sold')
    ) then
      return 'not_held';
    end if;
    return 'not_found';
  end if;

  update public.items set status = 'listed' where id = p_item and status = 'held';
  update public.carts set updated_at = now() where id = p_cart;
  return 'released';
end;
$$;

revoke all on function public.release_hold(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_hold(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- organizer_sale_summary: totals for the organizer dashboard without row access to
-- purchase_units or carts. Raises 42501 for anyone but the sale's organizer.
-- Adds paid_order_count (carts in the sale that are paid or partially paid) and
-- fundraiser_goal (null when the organizer set none) to the init version.
-- ---------------------------------------------------------------------------

create or replace function public.organizer_sale_summary(p_sale uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not private.is_sale_organizer(p_sale) then
    raise exception 'only the organizer can read this sale summary' using errcode = '42501';
  end if;

  with hh as (
    select h.id, h.label, h.paypal_status, h.paused
    from public.households h
    where h.sale_id = p_sale
  ), item_counts as (
    select
      i.household_id,
      count(*) filter (where i.status = 'listed') as listed,
      count(*) filter (where i.status = 'held') as held,
      count(*) filter (where i.status in ('sold', 'collected')) as sold,
      count(*) filter (where i.status = 'collected') as collected,
      count(*) filter (where i.status = 'cash_sold') as cash_sold,
      coalesce(sum(i.price) filter (where i.status = 'cash_sold'), 0) as cash_total
    from public.items i
    where i.household_id in (select id from hh)
    group by i.household_id
  ), unit_totals as (
    select
      pu.household_id,
      coalesce(sum(pu.amount), 0) as gross
    from public.purchase_units pu
    join public.carts c on c.id = pu.cart_id
    where c.sale_id = p_sale
      and pu.capture_status = 'COMPLETED'
      and coalesce(pu.refund_status, '') <> 'COMPLETED'
    group by pu.household_id
  ), per_household as (
    select
      hh.id,
      hh.label,
      hh.paypal_status,
      hh.paused,
      coalesce(ic.listed, 0) as items_listed,
      coalesce(ic.held, 0) as items_held,
      coalesce(ic.sold, 0) as items_sold,
      coalesce(ic.collected, 0) as items_collected,
      coalesce(ic.cash_sold, 0) as items_cash_sold,
      coalesce(ic.cash_total, 0) as cash_total,
      coalesce(ut.gross, 0) as gross
    from hh
    left join item_counts ic on ic.household_id = hh.id
    left join unit_totals ut on ut.household_id = hh.id
  )
  select jsonb_build_object(
    'sale_id', p_sale,
    'households', (select count(*) from hh),
    'households_linked', (select count(*) from hh where paypal_status = 'ready'),
    'items_listed', (select coalesce(sum(items_listed), 0) from per_household),
    'items_held', (select coalesce(sum(items_held), 0) from per_household),
    'items_sold', (select coalesce(sum(items_sold), 0) from per_household),
    'items_collected', (select coalesce(sum(items_collected), 0) from per_household),
    'items_cash_sold', (select coalesce(sum(items_cash_sold), 0) from per_household),
    'gross_total', (select coalesce(sum(gross), 0) from per_household),
    'cash_total', (select coalesce(sum(cash_total), 0) from per_household),
    'fundraiser_total', coalesce((select gross from unit_totals where household_id is null), 0),
    'fundraiser_goal', (select s.fundraiser_goal from public.sales s where s.id = p_sale),
    'paid_order_count', (
      select count(*) from public.carts c
      where c.sale_id = p_sale and c.status in ('paid', 'partial')
    ),
    'per_household', coalesce((
      select jsonb_agg(jsonb_build_object(
        'household_id', ph.id,
        'label', ph.label,
        'paypal_status', ph.paypal_status,
        'paused', ph.paused,
        'items_listed', ph.items_listed,
        'items_held', ph.items_held,
        'items_sold', ph.items_sold,
        'items_collected', ph.items_collected,
        'items_cash_sold', ph.items_cash_sold,
        'cash_total', ph.cash_total,
        'gross', ph.gross
      ) order by ph.label)
      from per_household ph
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.organizer_sale_summary(uuid) from public, anon, authenticated;
grant execute on function public.organizer_sale_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guard: the SECURITY DEFINER functions above must not be filtered by the forced RLS.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_roles r
    where r.rolname = current_user and (r.rolsuper or r.rolbypassrls)
  ) then
    raise exception
      'Rummage migrations must run as a role with BYPASSRLS (Supabase: postgres). Current role: %',
      current_user;
  end if;
end;
$$;
