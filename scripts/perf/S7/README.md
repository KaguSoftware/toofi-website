# Track S7: server and data

Scripts for search track S7 of the optimization plan ([docs/zaitun/OPTIMIZATION_PLAN.md](../../../docs/zaitun/OPTIMIZATION_PLAN.md)). They run on the P0 rig (same production build, same lock, charger required; see [../README.md](../README.md)) and change no product code. Findings: `docs/zaitun/perf/findings/S7.md`.

| Command | What it does |
|---|---|
| `node scripts/perf/S7/request.mjs [local\|supabase\|all] [--runs 20] [--latency 40]` | Local mode: per page time to first byte, to the page content and to the end, headers; public files (matched and not matched by `proxy.ts`); the image optimizer, first request against repeats. Supabase mode: a second build against a mock PostgREST that counts every query and adds `--latency` ms; queries per page on the first visit and repeats, queries during `next build`, a flood of distinct unknown slugs |
| `node scripts/perf/S7/show.mjs <result.json>` | Prints the Markdown tables of a saved result |

The mock (`lib.mjs`) serves `data/seed` through the PostgREST shapes the app reads (`pages`, `published_content`, `maybeSingle`). `NEXT_PUBLIC_SUPABASE_URL` is fixed at build time, so the mock listens on a fixed port (54329) and must be up while `next build` runs. The Supabase-mode build lives in `~/.cache/sawad-perf/work/<checkout>-supabase/`.
