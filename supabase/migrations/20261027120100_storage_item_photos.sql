-- Rummage: item photo storage.
--
-- Bucket `item-photos` is public-read (photos are served by public URL to anyone browsing
-- the sale). Uploads, replacements and deletes are allowed only under
-- `households/<household_id>/...` for a household the signed-in user owns.
-- Seed photos live under `seed/` and are uploaded with the service role.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-photos',
  'item-photos',
  true,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- Path layout: households/<household_id>/<file>. storage.foldername(name) returns the
-- folder segments, so [1] = 'households' and [2] = the household id.

create policy item_photos_insert_own_household on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = 'households'
    and private.owns_household_text((storage.foldername(name))[2])
  );

-- Needed for upsert/replace and for listing one's own folder. Public reads go through
-- the public bucket URL and do not need a policy.
create policy item_photos_select_own_household on storage.objects
  for select to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = 'households'
    and private.owns_household_text((storage.foldername(name))[2])
  );

create policy item_photos_update_own_household on storage.objects
  for update to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = 'households'
    and private.owns_household_text((storage.foldername(name))[2])
  )
  with check (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = 'households'
    and private.owns_household_text((storage.foldername(name))[2])
  );

create policy item_photos_delete_own_household on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'item-photos'
    and (storage.foldername(name))[1] = 'households'
    and private.owns_household_text((storage.foldername(name))[2])
  );
