-- Rummage: count capture attempts per cart.
--
-- POST /api/paypal/capture used to send the same PayPal-Request-Id on every attempt for a
-- cart. After a decline (INSTRUMENT_DECLINED), the buyer picks another funding source and
-- the order is captured again, but PayPal may answer a reused request id with the cached
-- error from the first attempt. The route now bumps carts.capture_attempts at the start of
-- every capture call and sends `capture:<cart id>:<attempt>`, so each attempt is distinct.
-- A replay of an order that is already captured is resolved by reading the order.
--
-- Security posture is unchanged: no new client grant. Buyers keep the init migration's
-- table-level select on their own carts (RLS), so they can read the counter; only the
-- service role writes it. RLS stays enabled and forced; no policy changes.

alter table public.carts
  add column if not exists capture_attempts integer not null default 0
    check (capture_attempts >= 0);

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
