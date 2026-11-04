-- Rummage: a seller's item photo must live under the seller's own household folder.
--
-- Sellers have an update grant on items.photo_path, and the storage bucket only lets them
-- write under households/<their household>/. Nothing stopped a client update from pointing
-- an item at another household's photo (or any object), which the listing would then show
-- and the server would read back for the prohibited-item screen. The client-write guard
-- now refuses a photo_path outside households/<household_id>/. Service-role writes (the
-- seed uses seed/*.jpg) are untouched, as before.
--
-- Security posture: no new client grants. RLS stays enabled and forced.

create or replace function private.guard_item_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.photo_path is not null
     and new.photo_path not like 'households/' || new.household_id::text || '/%' then
    raise exception 'item photo must be under households/%/', new.household_id
      using errcode = '42501';
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
