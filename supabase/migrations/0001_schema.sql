-- 0001_schema.sql — core tables for the Sawad CMS.
-- RLS, grants and policies live in 0003; RPCs in 0004; storage in 0005.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / guarded DO blocks.

-- ───────────── enum ─────────────
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'app_role') then
    -- 'member' = signed-up but no permissions at all (default for new users).
    create type public.app_role as enum ('member', 'viewer', 'editor', 'admin');
  end if;
end $$;

-- ───────────── shared trigger: updated_at ─────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ───────────── profiles (1:1 with auth.users) ─────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null default '',
  name       text not null default '',
  role       public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ───────────── pages ─────────────
create table if not exists public.pages (
  id           uuid primary key default gen_random_uuid(),
  -- Mirrors slugSchema in lib/content/schemas.ts: "/" or "/a-b/c-d" (lowercase kebab segments).
  slug         text not null unique
               constraint pages_slug_format check (
                 slug ~ '^/([a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*)?$' and char_length(slug) <= 200
               ),
  title        text not null check (char_length(title) between 1 and 200),
  template     text not null check (template ~ '^[a-z0-9-]+$' and char_length(template) <= 64),
  status       text not null default 'draft' check (status in ('draft', 'published')),
  seo          jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz,
  created_by   uuid references auth.users (id) on delete set null
);
create index if not exists pages_status_idx on public.pages (status);
create index if not exists pages_created_by_idx on public.pages (created_by);

-- Status gate + published_at stamp (SQL equivalent of LocalProvider.updatePage):
--  * changing `status` (or inserting a non-draft page) requires content:publish, so
--    pages:manage alone cannot take pages live;
--  * published_at is stamped when a page becomes published (kept when un-publishing).
-- Callers with no end-user JWT (secret key, SQL editor, seeds) are trusted.
create or replace function public.pages_stamp_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and ((tg_op = 'INSERT' and new.status <> 'draft')
          or (tg_op = 'UPDATE' and new.status is distinct from old.status))
     and not public.has_permission('content:publish') then
    raise exception 'Not allowed to change page status' using errcode = '42501';
  end if;

  if new.status = 'published'
     and ((tg_op = 'INSERT' and new.published_at is null)
          or (tg_op = 'UPDATE' and old.status is distinct from 'published')) then
    new.published_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists pages_stamp_published_at on public.pages;
create trigger pages_stamp_published_at before insert or update on public.pages
  for each row execute function public.pages_stamp_published_at();

drop trigger if exists pages_set_updated_at on public.pages;
create trigger pages_set_updated_at before update on public.pages
  for each row execute function public.set_updated_at();

-- ───────────── content_blocks ─────────────
-- Scope design: a block belongs either to a page (page_id set; FK ON DELETE CASCADE
-- removes its blocks + revisions with the page) or to the site ("global": page_id NULL).
-- `scope` is a STORED generated column = page_id::text | 'global' so that the app's
-- Scope type ("global" | page uuid), RPC scope arrays and the (scope, key) uniqueness
-- all work without NULL special-casing.
create table if not exists public.content_blocks (
  id         uuid primary key default gen_random_uuid(),
  page_id    uuid references public.pages (id) on delete cascade,
  scope      text generated always as (coalesce(page_id::text, 'global')) stored,
  key        text not null check (key ~ '^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$' and char_length(key) <= 200),
  type       text not null check (type in ('text', 'richtext', 'image', 'link', 'list')),
  draft      jsonb,       -- NULL = no pending change
  published  jsonb,       -- NULL = never published
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint content_blocks_scope_key_unique unique (scope, key)
);
create index if not exists content_blocks_page_id_idx on public.content_blocks (page_id);
create index if not exists content_blocks_updated_by_idx on public.content_blocks (updated_by);
-- Partial index for "has unpublished changes?" lookups.
create index if not exists content_blocks_has_draft_idx on public.content_blocks (scope) where draft is not null;

drop trigger if exists content_blocks_set_updated_at on public.content_blocks;
create trigger content_blocks_set_updated_at before update on public.content_blocks
  for each row execute function public.set_updated_at();

-- ───────────── content_revisions ─────────────
create table if not exists public.content_revisions (
  id         uuid primary key default gen_random_uuid(),
  block_id   uuid not null references public.content_blocks (id) on delete cascade,
  type       text not null check (type in ('text', 'richtext', 'image', 'link', 'list')),
  value      jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
create index if not exists content_revisions_block_idx on public.content_revisions (block_id, created_at desc);
create index if not exists content_revisions_created_by_idx on public.content_revisions (created_by);

-- ───────────── media ─────────────
create table if not exists public.media (
  id           uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  url          text not null,
  filename     text not null,
  content_type text not null,
  size         bigint not null check (size >= 0),
  width        integer check (width is null or width > 0),
  height       integer check (height is null or height > 0),
  alt          text not null default '',
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id) on delete set null
);
create index if not exists media_created_at_idx on public.media (created_at desc);
create index if not exists media_created_by_idx on public.media (created_by);
