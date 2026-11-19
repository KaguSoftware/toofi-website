# Sawad Web

The Sawad Holding website: a bilingual (English/Arabic) site for gated garden compounds,
with a 3D residence finder, an admin panel and **inline on-page content editing**, built on
Next.js 16.4, three.js and Supabase. See [docs/SAWAD.md](docs/SAWAD.md) for the site itself.

## Quick start (no database needed)

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no Supabase env vars, the app runs in **local mode**
on sample data (`data/seed/`), storing changes in `.data/` (delete it to reset).

Sign in at http://localhost:3000/admin/login. Every demo account uses the password `password`:

| Email | Role | Can |
|---|---|---|
| `admin@sawad.local` | admin | everything, including managing users |
| `editor@sawad.local` | editor | edit/publish content, manage pages and media |
| `viewer@sawad.local` | viewer | read-only admin |

To edit content, go to **Admin → Pages → Edit content**, or click **Edit page** on any page
while signed in.

## Connecting Supabase

See [docs/SUPABASE.md](docs/SUPABASE.md). In short: create the project, push
`supabase/migrations`, enable the auth hook, and set the env vars from `.env.example`.
The app switches to Supabase mode automatically.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` / `start` | production build and server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit tests (vitest) |
| `npm run db:seed-sql` | regenerate `supabase/seed.sql` from `data/seed/*.json` |

## Docs

- [docs/SAWAD.md](docs/SAWAD.md): the Sawad site: pages, content, owner settings, 3D scene, launch checklist
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it all fits together (backend, auth, caching, editing)
- [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md): building templates, editable components, design principles
- [docs/SUPABASE.md](docs/SUPABASE.md): database setup, RLS, migrations
