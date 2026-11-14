-- 0002_auth_rbac.sql — profile bootstrap, role → permission mapping, JWT hook.

-- ───────────── new auth user → profile ─────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in sync when the auth email changes.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- ───────────── has_permission ─────────────
-- Mirrors ROLE_PERMISSIONS in lib/auth/roles.ts — KEEP IN SYNC:
--   viewer: admin:access
--   editor: admin:access content:edit content:publish pages:manage media:manage
--   admin : everything (+ users:manage)
-- Role source: ALWAYS public.profiles (authoritative PK lookup). The JWT `user_role`
-- claim is deliberately NOT trusted: it stays valid for the token lifetime after a
-- demotion. `member` (the default for new sign-ups) has no permissions.
create or replace function public.has_permission(p text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r text;
begin
  select pr.role::text into r from public.profiles pr where pr.id = auth.uid();
  if r is null then
    return false;
  end if;

  return case r
    when 'viewer' then p = 'admin:access'
    when 'editor' then p in ('admin:access', 'content:edit', 'content:publish', 'pages:manage', 'media:manage')
    when 'admin'  then p in ('admin:access', 'content:edit', 'content:publish', 'pages:manage', 'media:manage', 'users:manage')
    else false
  end;
end;
$$;

revoke execute on function public.has_permission(text) from public;
grant execute on function public.has_permission(text) to anon, authenticated, service_role;

-- ───────────── prevent role self-escalation ─────────────
-- Clients have no UPDATE grant on `role` at all (0003); this trigger is a second barrier.
-- Requests with no end-user JWT (service role, dashboard SQL editor, migrations) are trusted.
create or replace function public.profiles_guard_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.role is distinct from old.role and not public.has_permission('users:manage') then
    raise exception 'Only administrators can change roles' using errcode = '42501';
  end if;
  -- Identity columns are managed by the auth triggers, never by the client.
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'profiles.id / profiles.email are read-only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns before update on public.profiles
  for each row execute function public.profiles_guard_columns();

-- ───────────── custom access token hook ─────────────
-- Adds a convenience `user_role` claim to the access token (informational only: RLS and
-- has_permission() read profiles, never this claim). Enable it in the dashboard
-- (Authentication → Hooks) or via supabase/config.toml for local dev.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  r      public.app_role;
begin
  select p.role into r from public.profiles p where p.id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{user_role}', to_jsonb(coalesce(r::text, 'member')));
  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Per Supabase docs: only supabase_auth_admin may run the hook, and it must be able to read profiles.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

grant select on table public.profiles to supabase_auth_admin;
-- (The RLS policy "auth admin reads profiles" is created in 0003.)
