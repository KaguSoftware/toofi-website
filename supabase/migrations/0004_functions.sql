-- 0004_functions.sql — the ONLY write path for content_blocks / content_revisions.
-- Clients have no INSERT/UPDATE/DELETE grants on those tables (0003). These functions are
-- SECURITY DEFINER (search_path locked), check has_permission() first, and take every
-- audit value (updated_by / created_by) from auth.uid(), never from input.
-- Scopes are 'global' or a page uuid (as text), matching content_blocks.scope.

-- ───────────── value shape validation (mirrors lib/content/schemas.ts, coarse) ─────────────
create or replace function public.validate_block_value(t text, v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case
    when v is null or jsonb_typeof(v) <> 'object' then false
    when t = 'text'     then jsonb_typeof(v -> 'text') = 'string'
    when t = 'link'     then jsonb_typeof(v -> 'text') = 'string' and jsonb_typeof(v -> 'href') = 'string'
    when t = 'image'    then jsonb_typeof(v -> 'src') = 'string' and jsonb_typeof(v -> 'alt') = 'string'
    when t = 'list'     then jsonb_typeof(v -> 'items') = 'array'
    when t = 'richtext' then jsonb_typeof(v -> 'doc') = 'object' and (v -> 'doc' ->> 'type') = 'doc'
    else false
  end, false);  -- missing keys yield NULL; treat as invalid
$$;

revoke execute on function public.validate_block_value(text, jsonb) from public, anon, authenticated;

-- ───────────── save_drafts ─────────────
-- changes: [{ "scope": "global"|uuid, "key": "...", "type": "text", "value": {...} }, ...]
-- Upserts drafts; keeps `published` untouched. Errors if an existing block has another type.
create or replace function public.save_drafts(changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c        jsonb;
  c_scope  text;
  c_key    text;
  c_type   text;
  c_page   uuid;
  existing public.content_blocks;
begin
  if not public.has_permission('content:edit') then
    raise exception 'Not allowed to edit content' using errcode = '42501';
  end if;
  if jsonb_typeof(changes) is distinct from 'array' then
    raise exception 'changes must be a JSON array';
  end if;

  for c in select * from jsonb_array_elements(changes) loop
    c_scope := c ->> 'scope';
    c_key   := c ->> 'key';
    c_type  := c ->> 'type';

    if c_scope is null or c_key is null or c_type is null then
      raise exception 'Each change needs scope, key and type';
    end if;
    if c_type not in ('text', 'richtext', 'image', 'link', 'list') then
      raise exception 'Unknown block type %', c_type;
    end if;
    if not public.validate_block_value(c_type, c -> 'value') then
      raise exception 'Invalid value for % block %', c_type, c_key;
    end if;

    if c_scope = 'global' then
      c_page := null;
    elsif c_scope ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      c_page := c_scope::uuid;
      if not exists (select 1 from public.pages p where p.id = c_page) then
        raise exception 'Page % does not exist', c_scope;
      end if;
    else
      raise exception 'Invalid scope %', c_scope;
    end if;
    c_scope := coalesce(c_page::text, 'global');

    select * into existing from public.content_blocks b where b.scope = c_scope and b.key = c_key for update;

    if found then
      if existing.type <> c_type then
        raise exception 'Block % is type %, got %', c_key, existing.type, c_type;
      end if;
      update public.content_blocks
         set draft = c -> 'value', updated_by = auth.uid()
       where id = existing.id;
    else
      insert into public.content_blocks (page_id, key, type, draft, published, updated_by)
      values (c_page, c_key, c_type, c -> 'value', null, auth.uid());
    end if;
  end loop;
end;
$$;

-- ───────────── publish_scopes ─────────────
-- draft → published for every block with a draft in the scopes, one revision each. Returns count.
create or replace function public.publish_scopes(scopes text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.has_permission('content:publish') then
    raise exception 'Not allowed to publish content' using errcode = '42501';
  end if;

  with updated as (
    update public.content_blocks
       set published = draft,
           draft = null,
           updated_by = auth.uid()
     where scope = any (scopes) and draft is not null
    returning id, type, published
  ), revs as (
    insert into public.content_revisions (block_id, type, value, created_by)
    select id, type, published, auth.uid() from updated
    returning 1
  )
  select count(*) into n from revs;

  return coalesce(n, 0);
end;
$$;

-- ───────────── discard_drafts ─────────────
-- Never-published blocks are deleted entirely; the rest just lose their draft.
create or replace function public.discard_drafts(scopes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('content:edit') then
    raise exception 'Not allowed to edit content' using errcode = '42501';
  end if;

  delete from public.content_blocks where scope = any (scopes) and published is null;
  update public.content_blocks set draft = null, updated_by = auth.uid()
   where scope = any (scopes) and draft is not null;
end;
$$;

-- ───────────── restore_revision ─────────────
create or replace function public.restore_revision(revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rev public.content_revisions;
begin
  if not public.has_permission('content:edit') then
    raise exception 'Not allowed to edit content' using errcode = '42501';
  end if;

  select * into rev from public.content_revisions r where r.id = revision_id;
  if not found then
    raise exception 'Revision not found';
  end if;

  update public.content_blocks
     set draft = rev.value, updated_by = auth.uid()
   where id = rev.block_id;
  if not found then
    raise exception 'Block not found';
  end if;
end;
$$;

-- Callable by signed-in users only (permission checked inside); never by anon.
revoke execute on function public.save_drafts(jsonb)       from public, anon;
revoke execute on function public.publish_scopes(text[])   from public, anon;
revoke execute on function public.discard_drafts(text[])   from public, anon;
revoke execute on function public.restore_revision(uuid)   from public, anon;
grant  execute on function public.save_drafts(jsonb)       to authenticated;
grant  execute on function public.publish_scopes(text[])   to authenticated;
grant  execute on function public.discard_drafts(text[])   to authenticated;
grant  execute on function public.restore_revision(uuid)   to authenticated;
