/**
 * Helpers for track S7 (server and data): a mock PostgREST that serves the seed data, counts
 * every query and adds a fixed latency, and the timing of one streamed HTTP response.
 * Plain Node, no browser, unit tested (lib.test.ts).
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "../lib.mjs";

const seed = (name) => JSON.parse(readFileSync(join(REPO_DIR, "data/seed", name), "utf8"));

/** Rows the app reads from Supabase, built from data/seed (same shapes as database.types.ts). */
export function seedRows() {
  const pages = seed("pages.json").map((p) => ({
    id: p.id, slug: p.slug, title: p.title, template: p.template, status: p.status, seo: p.seo,
    created_at: p.createdAt, updated_at: p.updatedAt, published_at: p.publishedAt, created_by: null,
  }));
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const content = seed("blocks.json").map((b) => {
    const scope = b.scope === "global" ? "global" : (bySlug.get(b.scope)?.id ?? b.scope);
    return { id: `${scope}:${b.key}`, page_id: null, scope, key: b.key, type: b.type, published: b.value, updated_at: null };
  });
  return { pages, content };
}

/** Which table and filters a PostgREST URL asks for: `eq.x` filters become {col: "x"}. */
export function parseQuery(url) {
  const u = new URL(url, "http://x");
  const table = u.pathname.replace(/^\/rest\/v1\//, "");
  const eq = {};
  for (const [k, v] of u.searchParams) if (v.startsWith("eq.")) eq[k] = v.slice(3);
  return { table, eq, select: u.searchParams.get("select"), accept: "" };
}

/** Rows a query returns from the seed rows. */
export function answer(rows, { table, eq }) {
  const source = table === "pages" ? rows.pages : table === "published_content" ? rows.content : [];
  return source.filter((r) => Object.entries(eq).every(([k, v]) => String(r[k]) === v));
}

/**
 * Mock PostgREST: counts queries (`log`), waits `latencyMs` before answering. `maybeSingle()`
 * sends `Accept: application/vnd.pgrst.object+json`, answered with one object or a 406.
 */
export function mockSupabase({ port, latencyMs = 40, rows = seedRows() }) {
  const log = [];
  const server = createServer((req, res) => {
    const q = parseQuery(req.url);
    const at = Date.now();
    log.push({ at, method: req.method, url: req.url, table: q.table, eq: q.eq });
    setTimeout(() => {
      if (!req.url.startsWith("/rest/v1/")) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end("{}");
      }
      const found = answer(rows, q);
      const single = String(req.headers.accept ?? "").includes("pgrst.object");
      if (single) {
        if (found.length !== 1) {
          res.writeHead(406, { "content-type": "application/json" });
          return res.end(JSON.stringify({ code: "PGRST116", message: "no rows", details: null, hint: null }));
        }
        res.writeHead(200, { "content-type": "application/vnd.pgrst.object+json" });
        return res.end(JSON.stringify(found[0]));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(found));
    }, latencyMs);
  });
  return {
    log,
    start: () => new Promise((ok) => server.listen(port, "127.0.0.1", ok)),
    stop: () => new Promise((ok) => (server.closeAllConnections?.(), server.close(ok))),
    reset: () => (log.length = 0),
    byTable: () => log.reduce((m, e) => ((m[e.table] = (m[e.table] ?? 0) + 1), m), {}),
  };
}

/**
 * One GET, streamed: time to first byte, to the first byte of `marker` (the page content, as
 * against the skeleton shell) and to the end; plus status, headers and size.
 */
export async function timeRequest(url, { marker = /** @type {string | null} */ (null), headers = {} } = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers, redirect: "manual" });
  const ttfb = performance.now() - t0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let tail = "";
  let markerAt = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (marker && markerAt === null) {
      tail += decoder.decode(value, { stream: true });
      if (tail.includes(marker)) markerAt = performance.now() - t0;
      tail = tail.slice(-marker.length);
    }
  }
  const h = Object.fromEntries(res.headers);
  return { status: res.status, ttfb, markerAt, total: performance.now() - t0, bytes, headers: h };
}
