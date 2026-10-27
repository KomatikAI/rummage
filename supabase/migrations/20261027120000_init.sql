-- Rummage: initial schema.
--
-- Tables: sales, households, items, carts, cart_lines, purchase_units, paypal_events.
-- Every table has RLS enabled AND forced. Client roles (anon, authenticated) get no
-- table privileges by default (Supabase grants them ALL through default privileges, so
-- this file revokes first and then grants narrowly, column by column where it matters).
--
-- Who can do what:
--   * organizer  : creates and updates their own sale; reads its households and items;
--                  money totals only through organizer_sale_summary().
--   * seller     : joins a sale through join_sale(invite_token, label); reads, updates and
--                  deletes their own household; full CRUD on its items (buyer-flow states
--                  'held', 'sold', 'collected' are locked); reads purchase_units for their
--                  household without the pickup code; confirms pickups via mark_item_collected().
--   * buyer      : creates their own cart; holds and releases items only through hold_item()
--                  and release_hold(); reads their own carts, lines and purchase units (no
--                  pickup code); reads exact pickup locations and codes ONLY through
--                  get_my_pickups(), after a COMPLETED capture.
--   * anyone     : reads public_sales and public_listings (public, jittered pins only).
--   * service    : everything else (PayPal order creation, captures, refunds, webhooks).
--
-- SECURITY DEFINER functions run as the migration role, which must bypass RLS (Supabase's
-- `postgres` role has BYPASSRLS). The guard at the end of this file fails the migration
-- loudly if that is not the case, instead of leaving the functions silently filtered by
-- the forced policies.

-- ---------------------------------------------------------------------------
-- Extensions and schemas
-- ---------------------------------------------------------------------------

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Helpers used by policies and triggers. Not exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organizer_user_id uuid references auth.users (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  description text check (description is null or char_length(description) <= 4000),
  sale_date date,
  starts_at time,
  ends_at time,
  area_lng double precision check (area_lng is null or area_lng between -180 and 180),
  area_lat double precision check (area_lat is null or area_lat between -90 and 90),
  area_radius_m integer check (area_radius_m is null or area_radius_m between 50 and 50000),
  fundraiser_name text check (fundraiser_name is null or char_length(btrim(fundraiser_name)) between 1 and 120),
  organizer_merchant_id text,
  invite_token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_at timestamptz not null default now(),
  constraint sales_hours_order check (starts_at is null or ends_at is null or starts_at < ends_at)
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete set null,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  exact_lng double precision check (exact_lng is null or exact_lng between -180 and 180),
  exact_lat double precision check (exact_lat is null or exact_lat between -90 and 90),
  -- Computed by private.jitter_household_location(): exact_* moved 60 to 180 m in a random
  -- direction. Clients can never write these columns.
  public_lng double precision,
  public_lat double precision,
  merchant_id_in_paypal text,
  tracking_id text not null unique default gen_random_uuid()::text,
  paypal_status text not null default 'unlinked'
    check (paypal_status in ('unlinked', 'pending', 'ready', 'revoked')),
  paypal_checked_at timestamptz,
  paused boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index households_sale_owner_key
  on public.households (sale_id, owner_user_id)
  where owner_user_id is not null;

create table public.items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  category text not null default 'other' check (category in (
    'kids', 'furniture', 'kitchen', 'garden', 'books', 'sports',
    'clothing', 'electronics', 'tools', 'decor', 'other'
  )),
  condition text not null default 'good'
    check (condition in ('new', 'like_new', 'good', 'fair', 'poor')),
  price numeric(10, 2) check (price is null or price >= 0),
  price_low numeric(10, 2) check (price_low is null or price_low >= 0),
  price_high numeric(10, 2) check (price_high is null or price_high >= 0),
  price_reason text check (price_reason is null or char_length(price_reason) <= 1000),
  photo_path text,
  status text not null default 'draft' check (status in (
    'draft', 'listed', 'held', 'sold', 'collected', 'cash_sold', 'hidden'
  )),
  prohibited_flag boolean not null default false,
  prohibited_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_price_range check (price_low is null or price_high is null or price_low <= price_high),
  -- Anything a buyer can see or pay for needs a price.
  constraint items_priced_when_public check (status in ('draft', 'hidden') or price is not null),
  -- A flagged item can never be offered for sale.
  constraint items_prohibited_not_listed check (not (prohibited_flag and status = 'listed'))
);

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  buyer_user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sale_id uuid not null references public.sales (id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'checkout', 'paid', 'partial', 'failed', 'abandoned')),
  paypal_order_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live cart per buyer per sale.
create unique index carts_one_live_per_buyer_sale
  on public.carts (buyer_user_id, sale_id)
  where status in ('open', 'checkout');

create table public.cart_lines (
  cart_id uuid not null references public.carts (id) on delete cascade,
  item_id uuid not null references public.items (id),
  household_id uuid not null references public.households (id),
  price numeric(10, 2) not null check (price >= 0),
  hold_expires_at timestamptz not null,
  -- true while the cart is 'open' or 'checkout'. Kept in sync by
  -- private.sync_cart_lines_active() because a partial index cannot look at carts.status.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (cart_id, item_id)
);

-- An item can be in only one open/checkout cart at a time.
create unique index cart_lines_one_live_hold_per_item
  on public.cart_lines (item_id)
  where active;

create table public.purchase_units (
  id uuid primary key default gen_random_uuid(),
  -- No cascade: money records outlive carts (and block deleting a buyer who paid).
  cart_id uuid not null references public.carts (id),
  -- null = the donation unit to the organizer.
  household_id uuid references public.households (id),
  reference_id text not null,
  amount numeric(10, 2) not null check (amount >= 0),
  merchant_id text not null,
  capture_id text,
  capture_status text,
  seller_receivable numeric(10, 2),
  refund_id text,
  refund_status text,
  pickup_code text check (pickup_code is null or pickup_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_units_cart_reference_key unique (cart_id, reference_id)
);

create table public.paypal_events (
  event_id text primary key,
  event_type text not null,
  resource_type text,
  resource_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload jsonb not null
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index sales_organizer_idx on public.sales (organizer_user_id);
create index households_sale_idx on public.households (sale_id);
create index households_owner_idx on public.households (owner_user_id) where owner_user_id is not null;
create index households_merchant_idx on public.households (merchant_id_in_paypal) where merchant_id_in_paypal is not null;
-- households.tracking_id lookups use the unique constraint's index.
create index items_household_status_idx on public.items (household_id, status);
create index items_status_idx on public.items (status);
create index carts_buyer_sale_idx on public.carts (buyer_user_id, sale_id);
create index carts_sale_idx on public.carts (sale_id);
create index carts_status_updated_idx on public.carts (status, updated_at) where status in ('open', 'checkout');
create index cart_lines_item_idx on public.cart_lines (item_id);
create index cart_lines_household_idx on public.cart_lines (household_id);
create index cart_lines_expiry_idx on public.cart_lines (hold_expires_at) where active;
-- purchase_units by cart uses the (cart_id, reference_id) unique index.
create unique index purchase_units_capture_id_key on public.purchase_units (capture_id) where capture_id is not null;
create index purchase_units_household_idx on public.purchase_units (household_id) where household_id is not null;
create index paypal_events_resource_idx on public.paypal_events (resource_id);
create index paypal_events_unprocessed_idx on public.paypal_events (received_at) where processed_at is null;

-- ---------------------------------------------------------------------------
-- Private helpers (SECURITY DEFINER so policies on one table can look at another
-- table without RLS recursion between sales and households)
-- ---------------------------------------------------------------------------

create or replace function private.is_sale_organizer(p_sale uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sales s
    where s.id = p_sale
      and s.organizer_user_id is not null
      and s.organizer_user_id = (select auth.uid())
  );
$$;

create or replace function private.owns_household(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.households h
    where h.id = p_household
      and h.owner_user_id is not null
      and h.owner_user_id = (select auth.uid())
  );
$$;

-- Same check for a storage path segment: returns false (never raises) for a non-uuid.
create or replace function private.owns_household_text(p_household text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_household ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then private.owns_household(p_household::uuid)
    else false
  end;
$$;

create or replace function private.is_household_in_my_sale(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.households h
    join public.sales s on s.id = h.sale_id
    where h.id = p_household
      and s.organizer_user_id is not null
      and s.organizer_user_id = (select auth.uid())
  );
$$;

-- The caller has a household in this sale (sellers may read the sale they joined).
create or replace function private.is_sale_member(p_sale uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.households h
    where h.sale_id = p_sale
      and h.owner_user_id is not null
      and h.owner_user_id = (select auth.uid())
  );
$$;

create or replace function private.sale_is_open(p_sale uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.sales s where s.id = p_sale and s.status = 'open');
$$;

create or replace function private.is_my_cart(p_cart uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.carts c
    where c.id = p_cart and c.buyer_user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_sale_organizer(uuid) from public, anon, authenticated;
revoke all on function private.owns_household(uuid) from public, anon, authenticated;
revoke all on function private.owns_household_text(text) from public, anon, authenticated;
revoke all on function private.is_household_in_my_sale(uuid) from public, anon, authenticated;
revoke all on function private.is_sale_member(uuid) from public, anon, authenticated;
revoke all on function private.sale_is_open(uuid) from public, anon, authenticated;
revoke all on function private.is_my_cart(uuid) from public, anon, authenticated;
-- RLS policies are evaluated as the calling role, so it needs EXECUTE on each helper.
grant execute on function private.is_sale_organizer(uuid) to authenticated, service_role;
grant execute on function private.owns_household(uuid) to authenticated, service_role;
grant execute on function private.owns_household_text(text) to authenticated, service_role;
grant execute on function private.is_household_in_my_sale(uuid) to authenticated, service_role;
grant execute on function private.is_sale_member(uuid) to authenticated, service_role;
grant execute on function private.sale_is_open(uuid) to authenticated, service_role;
grant execute on function private.is_my_cart(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger items_set_updated_at before update on public.items
  for each row execute function private.set_updated_at();
create trigger carts_set_updated_at before update on public.carts
  for each row execute function private.set_updated_at();
create trigger purchase_units_set_updated_at before update on public.purchase_units
  for each row execute function private.set_updated_at();

-- public_* = exact_* moved 60 to 180 m in a random direction. Recomputed only when the
-- exact location changes, and pinned otherwise so no write can set public_* directly.
create or replace function private.jitter_household_location()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_distance_m double precision;
  v_bearing double precision;
begin
  if tg_op = 'UPDATE'
     and new.exact_lng is not distinct from old.exact_lng
     and new.exact_lat is not distinct from old.exact_lat then
    new.public_lng := old.public_lng;
    new.public_lat := old.public_lat;
    return new;
  end if;

  if new.exact_lng is null or new.exact_lat is null then
    new.public_lng := null;
    new.public_lat := null;
    return new;
  end if;

  v_distance_m := 60 + random() * 120;
  v_bearing := random() * 2 * pi();
  -- 111320 m per degree of latitude; longitude degrees shrink with cos(latitude).
  new.public_lat := new.exact_lat + (v_distance_m * cos(v_bearing)) / 111320.0;
  new.public_lng := new.exact_lng
    + (v_distance_m * sin(v_bearing)) / (111320.0 * greatest(cos(radians(new.exact_lat)), 0.01));
  return new;
end;
$$;

create trigger households_jitter_location
  before insert or update on public.households
  for each row execute function private.jitter_household_location();

-- Direct client writes to items (role `authenticated`) may only move an item between the
-- seller-controlled states. 'held', 'sold' and 'collected' belong to the buyer flow and
-- are changed only by the SECURITY DEFINER functions below (which run as the owner role,
-- so current_user is not 'authenticated' there).
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
    if new.status not in ('draft', 'listed', 'hidden') then
      raise exception 'a new item must start as draft, listed or hidden'
        using errcode = '42501';
    end if;
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
  return new;
end;
$$;

create trigger items_guard_client_write
  before insert or update on public.items
  for each row execute function private.guard_item_client_write();

-- Seller deletes are limited by the delete policy (seller-controlled states only).

-- cart_lines.active follows the cart: live while 'open'/'checkout', archived otherwise.
create or replace function private.sync_cart_lines_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    update public.cart_lines
       set active = (new.status in ('open', 'checkout'))
     where cart_id = new.id
       and active is distinct from (new.status in ('open', 'checkout'));
  end if;
  return new;
end;
$$;

create trigger carts_sync_lines_active
  after update of status on public.carts
  for each row execute function private.sync_cart_lines_active();

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.jitter_household_location() from public, anon, authenticated;
revoke all on function private.guard_item_client_write() from public, anon, authenticated;
revoke all on function private.sync_cart_lines_active() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security: enable + force on every table
-- ---------------------------------------------------------------------------

alter table public.sales enable row level security;
alter table public.sales force row level security;
alter table public.households enable row level security;
alter table public.households force row level security;
alter table public.items enable row level security;
alter table public.items force row level security;
alter table public.carts enable row level security;
alter table public.carts force row level security;
alter table public.cart_lines enable row level security;
alter table public.cart_lines force row level security;
alter table public.purchase_units enable row level security;
alter table public.purchase_units force row level security;
alter table public.paypal_events enable row level security;
alter table public.paypal_events force row level security;

-- Table privileges: start from nothing for client roles, then grant narrowly.
revoke all on table
  public.sales, public.households, public.items, public.carts,
  public.cart_lines, public.purchase_units, public.paypal_events
from public, anon, authenticated;

grant all on table
  public.sales, public.households, public.items, public.carts,
  public.cart_lines, public.purchase_units, public.paypal_events
to service_role;

-- sales ---------------------------------------------------------------------

grant select on public.sales to authenticated;
grant insert (
  organizer_user_id, name, slug, description, sale_date, starts_at, ends_at,
  area_lng, area_lat, area_radius_m, fundraiser_name
) on public.sales to authenticated;
-- organizer_merchant_id is written by the server after PayPal onboarding; invite_token
-- and slug are fixed once created.
grant update (
  name, description, sale_date, starts_at, ends_at,
  area_lng, area_lat, area_radius_m, fundraiser_name, status
) on public.sales to authenticated;

create policy sales_select_organizer_or_member on public.sales
  for select to authenticated
  using (
    organizer_user_id = (select auth.uid())
    or private.is_sale_member(id)
  );

create policy sales_insert_own on public.sales
  for insert to authenticated
  with check (organizer_user_id = (select auth.uid()));

create policy sales_update_own on public.sales
  for update to authenticated
  using (organizer_user_id = (select auth.uid()))
  with check (organizer_user_id = (select auth.uid()));

-- households ----------------------------------------------------------------
-- Created only through join_sale() so the invite token is checked.

grant select, delete on public.households to authenticated;
grant update (label, exact_lng, exact_lat, paused) on public.households to authenticated;

create policy households_select_owner_or_organizer on public.households
  for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or private.is_sale_organizer(sale_id)
  );

create policy households_update_owner on public.households
  for update to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

create policy households_delete_owner on public.households
  for delete to authenticated
  using (owner_user_id = (select auth.uid()));

-- items ---------------------------------------------------------------------
-- The public reads items through public_listings only.

grant select, delete on public.items to authenticated;
grant insert (
  household_id, title, description, category, condition,
  price, price_low, price_high, price_reason, photo_path, status
) on public.items to authenticated;
-- prohibited_flag / prohibited_reason are written by the server's moderation step only.
grant update (
  title, description, category, condition,
  price, price_low, price_high, price_reason, photo_path, status
) on public.items to authenticated;

create policy items_select_seller_or_organizer on public.items
  for select to authenticated
  using (
    private.owns_household(household_id)
    or private.is_household_in_my_sale(household_id)
  );

create policy items_insert_seller on public.items
  for insert to authenticated
  with check (private.owns_household(household_id));

create policy items_update_seller on public.items
  for update to authenticated
  using (private.owns_household(household_id))
  with check (private.owns_household(household_id));

create policy items_delete_seller on public.items
  for delete to authenticated
  using (
    private.owns_household(household_id)
    and status in ('draft', 'listed', 'hidden', 'cash_sold')
  );

-- carts ---------------------------------------------------------------------
-- Buyers create their own cart. Status and paypal_order_id change only through the
-- functions below or the server (service role).

grant select on public.carts to authenticated;
grant insert (buyer_user_id, sale_id) on public.carts to authenticated;

create policy carts_select_own on public.carts
  for select to authenticated
  using (buyer_user_id = (select auth.uid()));

create policy carts_insert_own on public.carts
  for insert to authenticated
  with check (
    buyer_user_id = (select auth.uid())
    and private.sale_is_open(sale_id)
  );

-- cart_lines ----------------------------------------------------------------
-- Written only by hold_item / release_hold / release_expired_holds / mark_units_captured.

grant select on public.cart_lines to authenticated;

create policy cart_lines_select_own on public.cart_lines
  for select to authenticated
  using (private.is_my_cart(cart_id));

-- purchase_units ------------------------------------------------------------
-- Written by the service role only. Client roles can read every column except
-- pickup_code (and the PayPal merchant id): the code reaches the buyer only through
-- get_my_pickups(), and the seller checks it only through mark_item_collected().
-- NOTE: because of these column grants, a client `select('*')` on purchase_units fails
-- with "permission denied"; list the columns explicitly.

grant select (
  id, cart_id, household_id, reference_id, amount, capture_id, capture_status,
  seller_receivable, refund_id, refund_status, created_at, updated_at
) on public.purchase_units to authenticated;

create policy purchase_units_select_seller on public.purchase_units
  for select to authenticated
  using (household_id is not null and private.owns_household(household_id));

create policy purchase_units_select_buyer on public.purchase_units
  for select to authenticated
  using (private.is_my_cart(cart_id));

-- paypal_events: service role only (no client grants, no policies).

-- ---------------------------------------------------------------------------
-- Public views (definer views: they expose only the columns listed here)
-- ---------------------------------------------------------------------------

create view public.public_sales
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
  s.status
from public.sales s
where s.status in ('open', 'closed');

create view public.public_listings
with (security_invoker = false)
as
select
  i.id as item_id,
  s.id as sale_id,
  s.slug as sale_slug,
  h.id as household_id,
  h.label as household_label,
  h.public_lng,
  h.public_lat,
  (h.paypal_status = 'ready') as accepts_paypal,
  i.title,
  i.description,
  i.category,
  i.condition,
  i.price,
  i.price_low,
  i.price_high,
  i.price_reason,
  i.photo_path,
  i.status,
  i.created_at
from public.items i
join public.households h on h.id = i.household_id
join public.sales s on s.id = h.sale_id
where i.status in ('listed', 'held', 'sold')
  and i.prohibited_flag = false
  and h.paused = false
  and s.status in ('open', 'closed');

revoke all on public.public_sales, public.public_listings from public, anon, authenticated;
grant select on public.public_sales, public.public_listings to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPC functions
-- ---------------------------------------------------------------------------

-- join_sale: a household joins a sale through its invite link. Idempotent per user.
create or replace function public.join_sale(p_invite_token text, p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_sale_id uuid;
  v_household_id uuid;
begin
  if v_uid is null then
    raise exception 'sign in to join a sale' using errcode = '42501';
  end if;

  select s.id into v_sale_id
  from public.sales s
  where s.invite_token = p_invite_token
    and s.status in ('draft', 'open');
  if v_sale_id is null then
    raise exception 'this invite link is not valid' using errcode = 'P0002';
  end if;

  select h.id into v_household_id
  from public.households h
  where h.sale_id = v_sale_id and h.owner_user_id = v_uid;
  if v_household_id is not null then
    return v_household_id;
  end if;

  insert into public.households (sale_id, owner_user_id, label)
  values (v_sale_id, v_uid, btrim(p_label))
  on conflict (sale_id, owner_user_id) where owner_user_id is not null do nothing
  returning id into v_household_id;

  if v_household_id is null then
    select h.id into v_household_id
    from public.households h
    where h.sale_id = v_sale_id and h.owner_user_id = v_uid;
  end if;
  return v_household_id;
end;
$$;

-- hold_item: put a listed item in the caller's open cart for 15 minutes.
--
-- Household cap: PayPal Orders v2 allows at most 10 purchase units per order, one per
-- household plus (when the sale is a fundraiser) one donation unit to the organizer.
-- When sales.fundraiser_name is set we always reserve that unit, so the cap is
-- 9 households, even if the buyer later gives no donation; otherwise 10. Reserving it
-- up front keeps the cap predictable instead of failing at checkout.
--
-- Returns false (never raises) when the hold is refused; true when held (or already
-- held in this cart, in which case the hold is refreshed).
create or replace function public.hold_item(p_item uuid, p_cart uuid)
returns boolean
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
    return false;
  end if;

  -- Lock the cart so concurrent holds cannot both pass the household cap.
  select * into v_cart from public.carts c where c.id = p_cart for update;
  if not found or v_cart.buyer_user_id <> v_uid or v_cart.status <> 'open' then
    return false;
  end if;

  -- Already held in this cart: refresh the hold.
  if exists (
    select 1 from public.cart_lines cl
    where cl.cart_id = p_cart and cl.item_id = p_item and cl.active
  ) then
    update public.cart_lines
       set hold_expires_at = now() + interval '15 minutes'
     where cart_id = p_cart and item_id = p_item;
    return true;
  end if;

  select * into v_item from public.items i where i.id = p_item for update;
  if not found or v_item.status <> 'listed' or v_item.prohibited_flag or v_item.price is null then
    return false;
  end if;

  select * into v_household from public.households h where h.id = v_item.household_id;
  if v_household.paused or v_household.paypal_status <> 'ready'
     or v_household.merchant_id_in_paypal is null then
    return false;
  end if;
  -- Sellers cannot buy their own items.
  if v_household.owner_user_id is not null and v_household.owner_user_id = v_uid then
    return false;
  end if;

  select * into v_sale from public.sales s where s.id = v_household.sale_id;
  if v_sale.id <> v_cart.sale_id or v_sale.status <> 'open' then
    return false;
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
      return false;
    end if;
  end if;

  update public.items set status = 'held' where id = p_item and status = 'listed';
  if not found then
    return false;
  end if;

  insert into public.cart_lines (cart_id, item_id, household_id, price, hold_expires_at, active)
  values (p_cart, p_item, v_household.id, v_item.price, now() + interval '15 minutes', true);

  update public.carts set updated_at = now() where id = p_cart;
  return true;
end;
$$;

-- release_hold: the buyer removes an item from their open cart.
create or replace function public.release_hold(p_item uuid, p_cart uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cart public.carts%rowtype;
begin
  if v_uid is null then
    return false;
  end if;

  select * into v_cart from public.carts c where c.id = p_cart for update;
  if not found or v_cart.buyer_user_id <> v_uid or v_cart.status <> 'open' then
    return false;
  end if;

  delete from public.cart_lines cl
   where cl.cart_id = p_cart and cl.item_id = p_item and cl.active;
  if not found then
    return false;
  end if;

  update public.items set status = 'listed' where id = p_item and status = 'held';
  update public.carts set updated_at = now() where id = p_cart;
  return true;
end;
$$;

-- release_expired_holds: cron / server sweep. Returns the number of items put back to
-- 'listed'.
--   * open carts: lines past hold_expires_at are released.
--   * checkout carts: holds are kept while the buyer is at PayPal; a checkout cart not
--     touched for 3 hours (PayPal's approval window) is abandoned and all its holds
--     released. The PayPal lane must set carts.status = 'checkout' before redirecting.
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
  with stale_checkout as (
    update public.carts c
       set status = 'abandoned'
     where c.status = 'checkout'
       and c.updated_at < now() - interval '3 hours'
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
  -- 'partial' carts with a PENDING capture still exist, so those holds are kept.
  update public.items i
     set status = 'listed'
   where i.status = 'held'
     and not exists (select 1 from public.cart_lines cl where cl.item_id = i.id);
  get diagnostics v_count = row_count;
  v_released := v_released + v_count;

  return v_released;
end;
$$;

-- Six characters from A-Z and 2-9 without 0, O, 1 and I (32 symbols, so byte % 32 is
-- unbiased).
create or replace function private.new_pickup_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(6);
  v_code text := '';
  i integer;
begin
  for i in 0..5 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

revoke all on function private.new_pickup_code() from public, anon, authenticated;

-- mark_units_captured: the server records the capture result for each purchase unit.
-- p_units: [{"reference_id": "...", "capture_id": "...", "capture_status": "COMPLETED",
--            "seller_receivable": 12.34}, ...]
--   * COMPLETED: pickup code generated (once), that household's held items in this cart
--     become 'sold'.
--   * DECLINED / FAILED: that household's holds in this cart are released.
--   * PENDING (or anything else): holds are kept; call again when the webhook settles it.
-- Cart status afterwards: 'paid' when every unit is COMPLETED, 'partial' when some are,
-- 'failed' when none are and none are still pending, otherwise unchanged.
-- Idempotent: safe to call again from the capture response and from the webhook.
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

-- mark_item_collected: the seller confirms a pickup with the buyer's code.
create or replace function public.mark_item_collected(p_item uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_uid is null or v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    return false;
  end if;

  select * into v_item from public.items i where i.id = p_item for update;
  if not found or v_item.status <> 'sold' or not private.owns_household(v_item.household_id) then
    return false;
  end if;

  if not exists (
    select 1
    from public.cart_lines cl
    join public.purchase_units pu
      on pu.cart_id = cl.cart_id and pu.household_id = cl.household_id
    where cl.item_id = p_item
      and cl.household_id = v_item.household_id
      and pu.capture_status = 'COMPLETED'
      and pu.pickup_code = v_code
  ) then
    return false;
  end if;

  update public.items set status = 'collected' where id = p_item;
  return true;
end;
$$;

-- get_my_pickups: the ONLY way a buyer learns an exact location or a pickup code, and
-- only for purchase units on their own carts whose capture COMPLETED.
create or replace function public.get_my_pickups()
returns table (
  purchase_unit_id uuid,
  cart_id uuid,
  sale_id uuid,
  sale_name text,
  household_id uuid,
  household_label text,
  item_id uuid,
  item_title text,
  item_status text,
  exact_lng double precision,
  exact_lat double precision,
  pickup_code text,
  capture_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pu.id,
    c.id,
    s.id,
    s.name,
    h.id,
    h.label,
    i.id,
    i.title,
    i.status,
    h.exact_lng,
    h.exact_lat,
    pu.pickup_code,
    pu.capture_status
  from public.carts c
  join public.sales s on s.id = c.sale_id
  join public.purchase_units pu on pu.cart_id = c.id
  join public.households h on h.id = pu.household_id
  join public.cart_lines cl on cl.cart_id = c.id and cl.household_id = h.id
  join public.items i on i.id = cl.item_id
  where (select auth.uid()) is not null
    and c.buyer_user_id = (select auth.uid())
    and pu.capture_status = 'COMPLETED'
  order by s.sale_date nulls last, h.label, i.title;
$$;

-- organizer_sale_summary: totals for the organizer dashboard without row access to
-- purchase_units. Raises 42501 for anyone but the sale's organizer.
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

-- Function privileges: nothing by default, then the narrow grant.
revoke all on function public.join_sale(text, text) from public, anon, authenticated;
revoke all on function public.hold_item(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_hold(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_expired_holds() from public, anon, authenticated;
revoke all on function public.mark_units_captured(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mark_item_collected(uuid, text) from public, anon, authenticated;
revoke all on function public.get_my_pickups() from public, anon, authenticated;
revoke all on function public.organizer_sale_summary(uuid) from public, anon, authenticated;

grant execute on function public.join_sale(text, text) to authenticated;
grant execute on function public.hold_item(uuid, uuid) to authenticated;
grant execute on function public.release_hold(uuid, uuid) to authenticated;
grant execute on function public.release_expired_holds() to service_role;
grant execute on function public.mark_units_captured(uuid, jsonb) to service_role;
grant execute on function public.mark_item_collected(uuid, text) to authenticated;
grant execute on function public.get_my_pickups() to authenticated;
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
