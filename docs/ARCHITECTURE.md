# Sawad Web — Architecture

Next.js 16.4 (App Router, Cache Components, Partial Prefetching) + Supabase.
Public website + admin panel + **inline on-page content editing**.

## Big picture

```
                    ┌────────────── app/(site)/[[...slug]]/page.tsx ──────────────┐
 visitor  ───────▶  │ slug → page record → template (templates/registry.ts)       │
                    │   published content via "use cache" (lib/content/get.ts)    │──▶ static HTML
                    │                                                             │
 editor in          │ getEditor(): draftMode ON + session has content:edit        │
 edit mode ──────▶  │   drafts via getData() (uncached) + <EditorRoot> islands    │──▶ editable page
                    └─────────────────────────────────────────────────────────────┘
                                   │ Server Actions (lib/content/actions.ts, lib/admin/actions.ts)
                                   ▼   requirePermission() → zod → getData() → updateTag()
                    ┌──────────────────────────── DataProvider ───────────────────┐
                    │ LocalProvider  (no env)   data/seed/*.json → .data/store.json│
                    │ SupabaseProvider (env)    Postgres + RLS + Storage           │
                    └──────────────────────────────────────────────────────────────┘
```

## Backend modes

| | Local mode | Supabase mode |
|---|---|---|
| Trigger | no Supabase env vars | `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Data | `.data/store.json` seeded from `data/seed/*.json` | Postgres (`supabase/migrations`) |
| Auth | seeded users, bcrypt, signed JWT cookie (`sawad_session`) | Supabase Auth (`@supabase/ssr`) |
| Media | `.data/uploads` served by `/api/media/*` | Storage bucket `content-media` |
| Production | refused unless `SAWAD_ALLOW_LOCAL_MODE=1` | ✔ |

Reset local data: delete `.data/`.

## Public site address

Set `NEXT_PUBLIC_SITE_URL` (for example `https://www.example.com`) in production. It is the base for the
absolute canonical and hreflang links and for `robots.txt` (`app/robots.ts`, `lib/site-url.ts`). On Vercel the
production domain is used when it is not set. With neither, those links stay relative, and search-engine
audits will flag them.

Switching is **only** env vars — app code talks to `getData()` (`lib/data/index.ts`) and
`getAuth()` (`lib/auth/index.ts`), never to a backend directly.

## Content model

- **Page** (`pages`): `slug` (`/`, `/about`, `/services/web`), `title`, `template`, `status`
  (`draft` → hidden from visitors), `seo`.
- **Block** (`content_blocks`): one editable thing on a page, identified by `(scope, key)`.
  `scope` = page id, or `"global"` for site-wide content (header, footer, nav).
  Each block has `draft` and `published` values. Types: `text`, `richtext`, `image`, `link`, `list`
  — schemas in `lib/content/schemas.ts` (single source of truth for validation).
- **List** blocks store ordered item ids; each item's fields are their own blocks:
  `features` = `{ items: ["a1", "b2"] }`, `features.a1.title` = `{ text: "Fast" }`.
- **Revision** (`content_revisions`): snapshot written on every publish; restorable into draft.
- Rich text is stored as Tiptap JSON with a node/mark whitelist and rendered by
  `RichTextView` (`lib/content/render-rich.tsx`) — never as HTML strings.

Templates declare blocks in code with `fallback` values, so a new page renders before any
content exists; the first save creates the rows. See `docs/FRONTEND_GUIDE.md`.

## Editing flow

1. Editor signs in (`/admin/login`). A non-httpOnly hint cookie `sawad_can_edit=1` lets the
   public pages show a small "Edit page" launcher without making those pages dynamic.
2. "Edit page" → `GET /api/edit/enable?path=/about` → re-checks `content:edit`, looks the page
   up in the DB, enables Next.js **Draft Mode**, redirects to the DB slug (no open redirect).
3. The page renders drafts with `createEditables({ editing: true })`, which swaps plain HTML for
   client islands (`components/editable/*`). Visitors never download editor code.
4. Save draft / Publish / Discard / History are Server Actions. Publish copies draft → published,
   writes revisions, and calls `updateTag("content:<scope>")` so the cached public page refreshes.
5. Exit → Draft Mode off.

Draft Mode alone is never trusted: `getEditor()` (`lib/content/render-context.ts`) also requires a
valid session with `content:edit` on every request.

## Caching

- Public reads (`lib/content/get.ts`) use `"use cache"` + `cacheTag` + `cacheLife("max")`.
  Published pages are prerendered at build (`generateStaticParams`) and served static.
- New pages created later are rendered on first visit and then cached (ISR with Cache Components).
- Tags live in `lib/content/tags.ts`; every write action calls `updateTag()` with the matching tag.
- Draft Mode bypasses all caches for the editor only.

## Authorization

Roles (`lib/auth/roles.ts`):

| Permission | member | viewer | editor | admin |
|---|:-:|:-:|:-:|:-:|
| `admin:access` (open /admin) | | ✔ | ✔ | ✔ |
| `content:edit` (edit mode, drafts) | | | ✔ | ✔ |
| `content:publish` | | | ✔ | ✔ |
| `pages:manage` | | | ✔ | ✔ |
| `media:manage` | | | ✔ | ✔ |
| `users:manage` | | | | ✔ |

`member` is the default for new Supabase sign-ups and has no permissions until an admin promotes them.

Enforced in three layers:
1. `proxy.ts` — optimistic: signed-out users are bounced from `/admin/*` (also refreshes Supabase session).
2. **Guards** (`lib/auth/guards.ts`) — `requirePermission()` at the top of every Server Action and
   Route Handler; `requirePagePermission()` in every protected page. This is the real check.
3. **Postgres** (Supabase mode): RLS on every table; `public.has_permission()` mirrors the table above and always reads the role from `profiles`. Content writes go only through validated `SECURITY DEFINER` RPCs (`save_drafts`, `publish_scopes`, ...), so a signed-in user calling PostgREST directly cannot skip validation, publishing rules, or revisions.

The role is always re-read server-side (DB/profile), never trusted from a cookie or client.

## Key files

| Path | Purpose |
|---|---|
| `lib/env.ts` | env validation, backend mode detection |
| `lib/auth/*` | roles, session, guards, local + Supabase auth |
| `lib/data/*` | DataProvider interface + local/Supabase implementations |
| `lib/content/schemas.ts` | block types, zod schemas |
| `lib/content/editables.tsx` | `createEditables()` — template API |
| `lib/content/get.ts` / `tags.ts` | cached public reads, cache tags |
| `lib/content/actions.ts` | editor Server Actions |
| `lib/admin/actions.ts` | admin Server Actions (pages, media, users, auth) |
| `components/editable/*` | edit-mode client islands, toolbar |
| `components/site/*`, `components/ui/*` | public site chrome + primitives |
| `templates/*` | page templates + registry |
| `app/(site)/[[...slug]]/page.tsx` | renders every CMS page |
| `app/admin/*` | admin panel |
| `app/api/edit/enable` | enter edit mode |
| `app/api/media/*` | local-mode uploads |
| `supabase/migrations/*` | schema, RLS, storage, auth hook |
| `data/seed/*` | sample data (local mode + `supabase/seed.sql` generator) |
