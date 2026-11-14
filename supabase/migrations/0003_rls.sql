-- 0003_rls.sql — grants, row level security, public read view.
--
-- DRAFT PRIVACY DESIGN (anon must never read content_blocks.draft):
--   RLS is row-level only, so hiding a *column* from the public needs either column
--   grants or a view. Column grants cannot distinguish "viewer/any signed-in user" from
--   "editor" (both use the `authenticated` DB role), so we use a VIEW:
--     * public.content_blocks     — full rows (drafts included). SELECT only for
--                                    content:edit. anon has NO privileges on it.
--     * public.published_content  — published values only, for published pages + global.
--                                    Runs with its owner's rights (security_invoker = off,
--                                    deliberately: it must read the RLS-protected table on
--                                    behalf of anon). It exposes only (id, page_id, scope,
--                                    key, type, published, updated_at) and filters rows
--                                    itself. Supabase's "security definer view" linter
--                                    warning (0010) is expected for this one view.
--   Public/anon reads in the app go through published_content; editor reads go through
--   content_blocks with the user's JWT.

-- ───────────── reset default grants (Supabase grants ALL to anon/authenticated) ─────────────
revoke all on table public.profiles          from anon, authenticated;
revoke all on table public.pages             from anon, authenticated;
revoke all on table public.content_blocks    from anon, authenticated;
revoke all on table public.content_revisions from anon, authenticated;
revoke all on table public.media             from anon, authenticated;

-- profiles: users may update ONLY their own `name` (column grant + policy). `role` is not
-- updatable by clients at all; roles change through the secret-key client (setUserRole).
grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;

grant select on public.pages to anon, authenticated;
grant insert, update, delete on public.pages to authenticated;

-- content_blocks / content_revisions: READ-ONLY for clients. All writes go through the
-- SECURITY DEFINER RPCs in 0004 (validation, revisions, audit columns).
grant select on public.content_blocks to authenticated;
grant select on public.content_revisions to authenticated;

grant select, insert, update, delete on public.media to authenticated;

-- ───────────── enable RLS everywhere ─────────────
alter table public.profiles          enable row level security;
alter table public.pages             enable row level security;
alter table public.content_blocks    enable row level security;
alter table public.content_revisions enable row level security;
alter table public.media             enable row level security;

-- ───────────── profiles ─────────────
drop policy if exists "profiles: read own or manage users" on public.profiles;
create policy "profiles: read own or manage users" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.has_permission('users:manage')));

-- Updates: own row only (and only `name`, via the column grant).
drop policy if exists "profiles: update own or manage users" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- The access token hook runs as supabase_auth_admin and must read roles.
drop policy if exists "auth admin reads profiles" on public.profiles;
create policy "auth admin reads profiles" on public.profiles
  for select to supabase_auth_admin
  using (true);

-- No insert/delete policies for clients: profiles are created by the auth trigger and
-- removed by cascade from auth.users.

-- ───────────── pages ─────────────
drop policy if exists "pages: read published or admin area" on public.pages;
create policy "pages: read published or admin area" on public.pages
  for select to anon, authenticated
  using (status = 'published' or (select public.has_permission('admin:access')));

drop policy if exists "pages: insert" on public.pages;
create policy "pages: insert" on public.pages
  for insert to authenticated
  with check ((select public.has_permission('pages:manage')));

drop policy if exists "pages: update" on public.pages;
create policy "pages: update" on public.pages
  for update to authenticated
  using ((select public.has_permission('pages:manage')))
  with check ((select public.has_permission('pages:manage')));

drop policy if exists "pages: delete" on public.pages;
create policy "pages: delete" on public.pages
  for delete to authenticated
  using ((select public.has_permission('pages:manage')));

-- ───────────── content_blocks (drafts: editors only) ─────────────
drop policy if exists "content_blocks: editors read" on public.content_blocks;
create policy "content_blocks: editors read" on public.content_blocks
  for select to authenticated
  using ((select public.has_permission('content:edit')));

-- Writes happen only in SECURITY DEFINER RPCs; drop any write policies from older drafts.
drop policy if exists "content_blocks: editors insert" on public.content_blocks;
drop policy if exists "content_blocks: editors update" on public.content_blocks;
drop policy if exists "content_blocks: editors delete" on public.content_blocks;

-- ───────────── content_revisions ─────────────
drop policy if exists "content_revisions: editors read" on public.content_revisions;
create policy "content_revisions: editors read" on public.content_revisions
  for select to authenticated
  using ((select public.has_permission('content:edit')));
drop policy if exists "content_revisions: publishers insert" on public.content_revisions;

-- ───────────── media ─────────────
drop policy if exists "media: read in admin area" on public.media;
create policy "media: read in admin area" on public.media
  for select to authenticated
  using ((select public.has_permission('admin:access')));

drop policy if exists "media: manage insert" on public.media;
create policy "media: manage insert" on public.media
  for insert to authenticated
  with check ((select public.has_permission('media:manage')));

drop policy if exists "media: manage update" on public.media;
create policy "media: manage update" on public.media
  for update to authenticated
  using ((select public.has_permission('media:manage')))
  with check ((select public.has_permission('media:manage')));

drop policy if exists "media: manage delete" on public.media;
create policy "media: manage delete" on public.media
  for delete to authenticated
  using ((select public.has_permission('media:manage')));

-- ───────────── public read view: published content only ─────────────
-- security_invoker = false (the default, stated explicitly): the view reads
-- content_blocks/pages with the owner's rights so anon needs no table access. The
-- WHERE clause is the entire public access policy — keep it tight.
drop view if exists public.published_content;
create view public.published_content
  with (security_invoker = false)
as
select
  b.id,
  b.page_id,
  b.scope,
  b.key,
  b.type,
  b.published,
  b.updated_at
from public.content_blocks b
left join public.pages p on p.id = b.page_id
where b.published is not null
  and (b.page_id is null or p.status = 'published');

revoke all on public.published_content from public, anon, authenticated;
grant select on public.published_content to anon, authenticated;
