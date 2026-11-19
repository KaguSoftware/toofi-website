# Supabase setup

Without Supabase env vars the app runs in local mode (JSON store). Setting
`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` switches to Supabase mode.

## 1. Create and link a project

1. Create a project at <https://supabase.com/dashboard> (Postgres 15+).
2. `npx supabase login`, then `npx supabase link --project-ref <ref>`.
3. Push the schema: `npx supabase db push` (applies `supabase/migrations/0001…0005`; they are re-runnable).

## 2. Enable the access token hook (required for role claims)

Dashboard -> Authentication -> Hooks -> **Customize Access Token (JWT) Claims** -> type *Postgres function*
-> `public.custom_access_token_hook`. Local dev gets this from `supabase/config.toml`.

The hook only adds an informational `user_role` claim. `public.has_permission()` (used by every RLS policy and
RPC) ignores it and always reads `public.profiles`, so a demoted user loses access immediately.

## 3. Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...        # server only; user admin (list users / change roles)
SUPABASE_MEDIA_BUCKET=content-media      # must match supabase/migrations/0005_storage.sql
```

Keys: Project Settings -> API Keys. Never expose the secret key to the browser. Also: Authentication ->
Providers -> Email: **disable sign-ups** (accounts are created by admins). If sign-ups stay open anyway, new
users get the `member` role, which has no permissions at all.

## 4. Seed data

- `supabase/seed.sql` = pages + blocks only, no credentials. `supabase db reset` (local) runs it automatically.
- `supabase/seed-users.local.sql` = demo users (`admin@sawad.local`, `editor@sawad.local`, `viewer@sawad.local`,
  password `password`). It is **not** in `config.toml`, so `db reset --linked` / `db push --include-seed` never
  create them. For **local** Supabase only, apply it deliberately:

  ```
  PGOPTIONS="-c sawad.allow_demo_users=on" psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed-users.local.sql
  ```

  The file aborts unless `sawad.allow_demo_users=on`, and also aborts if `auth.users` already holds non-demo accounts.
- Regenerate both after editing `data/seed/*.json`: `npm run db:seed-sql` (deterministic).

## 5. Create the first admin

1. Dashboard -> Authentication -> Users -> **Add user** (email + password, tick *Auto Confirm*).
   A `profiles` row is created automatically with role `member`.
2. Promote it (new accounts start as `member`) in the SQL editor (no end-user JWT, so the role-guard trigger allows it):

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

After that, admins change roles from the app (`setUserRole`, via the secret key).

## Design notes

- **Roles**: `public.app_role` (viewer/editor/admin). `public.has_permission(p)` mirrors `ROLE_PERMISSIONS` in
  `lib/auth/roles.ts` - update both together.
- **Global scope**: `content_blocks.page_id` is NULL for global blocks (FK `ON DELETE CASCADE` for page blocks);
  `scope` is a stored generated column (`page_id::text` or `'global'`), unique with `key`.
- **Drafts are invisible to anon**: `content_blocks` (which holds `draft`) has no anon grant and its SELECT policy
  requires `content:edit`. Public reads go through the view `public.published_content` (owner rights, exposes only
  published values of published pages + global). The Supabase "security definer view" lint on it is intentional.
- **Atomic operations**: `save_drafts`, `publish_scopes`, `discard_drafts`, `restore_revision` are `SECURITY DEFINER`
  RPCs with `search_path = ''` that check `has_permission()` first.
- **Role escalation**: clients have no UPDATE grant on `profiles.role` (only their own `name`); roles change via the
  secret-key client (`setUserRole`). A trigger is a second barrier. `has_permission()` reads `profiles`, never the JWT.
- **Roles**: `member` (default for new users, no permissions), `viewer`, `editor`, `admin`.
- **Writes**: `content_blocks` / `content_revisions` are read-only for clients; the `SECURITY DEFINER` RPCs are the
  only write path (shape validation, audit columns from `auth.uid()`). Changing `pages.status` needs `content:publish`
  (trigger).
- **Storage**: public bucket `content-media` (8 MB, jpeg/png/webp/gif/avif); upload/delete/list need `media:manage`
  (no anon select policy, so uploads cannot be enumerated; public URLs still work).
- **Which client where** (see header of `lib/data/supabase.ts`): published reads use a cookie-less anon client
  (safe in `"use cache"`); everything user-scoped uses the cookie client; user admin uses the secret key.
  `supabaseProvider` page reads are anon (published only); `supabaseSessionProvider` page reads use the session so
  editors see draft pages (admin UI / edit mode only, never inside `"use cache"`).
