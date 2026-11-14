-- 0005_storage.sql — public media bucket. Writes need media:manage.
-- Keep SUPABASE_MEDIA_BUCKET (default "content-media") in sync with this id.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-media',
  'content-media',
  true,
  8 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public buckets serve objects by URL without any policy. Deliberately NO anon/public
-- select policy: it would let anyone enumerate every upload through the Storage list API.
-- Media managers need select so the Storage API can see rows for delete/list.
drop policy if exists "content-media: read" on storage.objects;
create policy "content-media: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'content-media' and (select public.has_permission('media:manage')));

drop policy if exists "content-media: upload" on storage.objects;
create policy "content-media: upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'content-media' and (select public.has_permission('media:manage')));

drop policy if exists "content-media: delete" on storage.objects;
create policy "content-media: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'content-media' and (select public.has_permission('media:manage')));
