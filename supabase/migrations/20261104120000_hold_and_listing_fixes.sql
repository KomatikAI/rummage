-- Rummage: hold and listing fixes.
--
-- 1. Expired holds are freed without anyone pressing a button.
--    * hold_item releases an expired hold on the item being held (another buyer's open
--      cart), so the next buyer is never blocked by a hold that already ran out.
--    * release_expired_holds is scheduled every minute with pg_cron when the extension
--      can be enabled; otherwise the migration says so and the README line still applies.
--
-- 2. A checkout cart whose payment has started is never abandoned. The 3 hour sweep used
--    to abandon any untouched checkout cart, relisting its items even when a capture was
--    PENDING, so the item could sell again while the first buyer was still charged. The
--    sweep now skips carts with any purchase unit that has a capture id or status, and
--    skips carts another transaction holds locked (mark_units_captured locks the cart).
--
-- 3. Only screened items can be listed. Sellers could insert or update an item straight
--    to 'listed' with their own key and skip the prohibited-item screen. items.screened_at
--    is set only by the server after the screen passes (no client grant). The guard now
--    refuses a client insert as 'listed', refuses a client move to 'listed' without
--    screened_at, and clears screened_at when a client changes what was screened.
--
-- 4. mark_units_captured raises a warning when a COMPLETED unit has no cart lines left
--    (a cancel or the sweep raced the capture), so money taken with nothing to hand over
--    shows up in the logs instead of passing as a normal paid cart.
--
-- Security posture: no new client grants. RLS stays enabled and forced.

-- ---------------------------------------------------------------------------
-- 3. items.screened_at
-- ---------------------------------------------------------------------------

alter table public.items
  add column if not exists screened_at timestamptz;

-- Items already past the draft stage were listed through the screened server action.
update public.items
   set screened_at = coalesce(screened_at, updated_at)
 where status <> 'draft' and not prohibited_flag;

create or replace function private.guard_item_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'hidden') then
      raise exception 'a new item must start as draft or hidden; the server lists it after screening'
        using errcode = '42501';
    end if;
    new.screened_at := null;
    return new;
  end if;

  if old.status in ('held', 'sold', 'collected') then
    raise exception 'item % is in a buyer checkout or sale and cannot be edited', old.id
      using errcode = '42501';
  end if;
  if new.status not in ('draft', 'listed', 'hidden', 'cash_sold') then
    raise exception 'sellers may set an item to draft, listed, hidden or cash_sold only'
      using errcode = '42501';
  end if;

  -- What the screen looked at changed: the item has to be screened again.
  if new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.category is distinct from old.category
     or new.photo_path is distinct from old.photo_path then
    new.screened_at := null;
  else
    new.screened_at := old.screened_at;
  end if;

  if new.status = 'listed' and new.screened_at is null then
    raise exception 'item % must pass the prohibited-item screen before it is listed', old.id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_item_client_write() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. hold_item: release an expired hold on the item first (otherwise unchanged)
-- ---------------------------------------------------------------------------

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

  -- New: a hold that ran out in another buyer's open cart is released here, so an
  -- expired hold never blocks the next buyer while waiting for the sweep.
  if v_item.status = 'held' then
    with gone as (
      delete from public.cart_lines cl
       using public.carts c
       where cl.item_id = p_item
         and cl.active
         and c.id = cl.cart_id
         and c.status = 'open'
         and cl.hold_expires_at < now()
      returning cl.item_id
    )
    update public.items i
       set status = 'listed'
      from gone g
     where i.id = g.item_id and i.status = 'held';
    if found then
      select * into v_item from public.items i where i.id = p_item;
    end if;
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
-- 2. release_expired_holds: never abandon a cart whose payment has started
-- ---------------------------------------------------------------------------

create or replace function public.release_expired_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer := 0;
  v_count integer;
begin
  with candidates as (
    select c.id
      from public.carts c
     where c.status = 'checkout'
       and c.updated_at < now() - interval '3 hours'
       and not exists (
         select 1 from public.purchase_units pu
          where pu.cart_id = c.id
            and (pu.capture_id is not null or pu.capture_status is not null)
       )
       for update skip locked
  ), stale_checkout as (
    update public.carts c
       set status = 'abandoned'
      from candidates k
     where c.id = k.id
    returning c.id
  ), gone as (
    delete from public.cart_lines cl
     using stale_checkout sc
     where cl.cart_id = sc.id
    returning cl.item_id
  )
  update public.items i
     set status = 'listed'
    from gone g
   where i.id = g.item_id and i.status = 'held';
  get diagnostics v_count = row_count;
  v_released := v_released + v_count;

  with gone as (
    delete from public.cart_lines cl
     using public.carts c
     where c.id = cl.cart_id
       and c.status = 'open'
       and cl.active
       and cl.hold_expires_at < now()
    returning cl.item_id
  )
  update public.items i
     set status = 'listed'
    from gone g
   where i.id = g.item_id and i.status = 'held';
  get diagnostics v_count = row_count;
  v_released := v_released + v_count;

  -- Orphans: 'held' items with no cart line at all (e.g. the cart was deleted). Lines of
  -- 'partial' carts and of checkout carts with a capture started still exist, so those
  -- holds are kept.
  update public.items i
     set status = 'listed'
   where i.status = 'held'
     and not exists (select 1 from public.cart_lines cl where cl.item_id = i.id);
  get diagnostics v_count = row_count;
  v_released := v_released + v_count;

  return v_released;
end;
$$;

revoke all on function public.release_expired_holds() from public, anon, authenticated;
grant execute on function public.release_expired_holds() to service_role;

-- Schedule the sweep every minute where pg_cron can be enabled.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available (%); schedule public.release_expired_holds() another way', sqlerrm;
    return;
  end;
  perform cron.schedule(
    'rummage-release-expired-holds',
    '* * * * *',
    'select public.release_expired_holds()'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. mark_units_captured: a completed unit with no lines is not a quiet success
-- ---------------------------------------------------------------------------

create or replace function public.mark_units_captured(p_cart uuid, p_units jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit record;
  v_pu public.purchase_units%rowtype;
  v_total integer;
  v_completed integer;
  v_unsettled integer;
  v_new_status text;
begin
  perform 1 from public.carts c where c.id = p_cart for update;
  if not found then
    raise exception 'cart % not found', p_cart using errcode = 'P0002';
  end if;
  if p_units is null or jsonb_typeof(p_units) <> 'array' then
    raise exception 'p_units must be a JSON array' using errcode = '22023';
  end if;

  for v_unit in
    select *
    from jsonb_to_recordset(p_units) as u(
      reference_id text,
      capture_id text,
      capture_status text,
      seller_receivable numeric
    )
  loop
    update public.purchase_units pu
       set capture_id = coalesce(v_unit.capture_id, pu.capture_id),
           capture_status = upper(v_unit.capture_status),
           seller_receivable = coalesce(v_unit.seller_receivable, pu.seller_receivable),
           pickup_code = case
             when upper(v_unit.capture_status) = 'COMPLETED'
                  and pu.household_id is not null
                  and pu.pickup_code is null
               then private.new_pickup_code()
             else pu.pickup_code
           end
     where pu.cart_id = p_cart and pu.reference_id = v_unit.reference_id
    returning pu.* into v_pu;

    if not found then
      -- Never abort the batch: money may already have moved for the other units.
      raise warning 'mark_units_captured: no purchase unit % in cart %', v_unit.reference_id, p_cart;
      continue;
    end if;

    if v_pu.household_id is null then
      continue; -- donation unit: nothing to hand over
    end if;

    if v_pu.capture_status = 'COMPLETED' then
      update public.items i
         set status = 'sold'
        from public.cart_lines cl
       where cl.cart_id = p_cart
         and cl.household_id = v_pu.household_id
         and cl.item_id = i.id
         and i.status = 'held';
      -- Money moved for this household but its lines are gone (a cancel or sweep raced
      -- the capture). Nothing to hand over: say so where the logs show it. The buyer's
      -- money is recoverable by refund; a silent success here would not be noticed.
      if not exists (
        select 1 from public.cart_lines cl
         where cl.cart_id = p_cart and cl.household_id = v_pu.household_id
      ) then
        raise warning 'mark_units_captured: unit % in cart % is COMPLETED but has no cart lines; refund it',
          v_pu.reference_id, p_cart;
      end if;
    elsif v_pu.capture_status in ('DECLINED', 'FAILED') then
      with gone as (
        delete from public.cart_lines cl
         where cl.cart_id = p_cart and cl.household_id = v_pu.household_id
        returning cl.item_id
      )
      update public.items i
         set status = 'listed'
        from gone g
       where i.id = g.item_id and i.status = 'held';
    end if;
  end loop;

  select
    count(*),
    count(*) filter (where pu.capture_status = 'COMPLETED'),
    count(*) filter (where pu.capture_status is null or pu.capture_status not in ('COMPLETED', 'DECLINED', 'FAILED'))
  into v_total, v_completed, v_unsettled
  from public.purchase_units pu
  where pu.cart_id = p_cart;

  v_new_status := case
    when v_total > 0 and v_completed = v_total then 'paid'
    when v_completed > 0 then 'partial'
    when v_total > 0 and v_unsettled = 0 then 'failed'
    else null
  end;

  if v_new_status is not null then
    update public.carts set status = v_new_status where id = p_cart and status <> v_new_status;
  end if;
end;
$$;

revoke all on function public.mark_units_captured(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mark_units_captured(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Guard: migrations must run as a role that bypasses RLS (same check as the others).
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
