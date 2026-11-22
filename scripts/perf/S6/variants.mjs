#!/usr/bin/env node
/**
 * Delivery variants (S6). Puts a small front server between the browser and the rig's build and
 * changes only how the files are delivered, never what they contain: brotli on models, the decoder
 * and data; long cache lifetimes (what versioned file names would allow); preload hints on the
 * document. Each variant is timed on a first visit and on a repeat visit (same browser context,
 * HTTP cache kept) under the phone and desktop profiles, through the rig's lock.
 *
 *   node scripts/perf/S6/variants.mjs [--variants base,br,immutable,...] [--profiles phone,desktop] [--runs 3]
 *
 * Variants: base (pass-through, as shipped), br, immutable, br+immutable, preload-core,
 * preload-all, all (br + immutable + preload-core).
 */
import { createServer, request as httpRequest } from "node:http";
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { launch, openPage, waitForScene } from "../browser.mjs";
import { fmtBytes, fmtMs, list, mdTable, median, parseArgs, saveResult } from "../lib.mjs";
import { outDirFor, withRig } from "../rig.mjs";
import { publicFiles } from "./delivery.mjs";

export const VARIANTS = {
  base: {},
  br: { br: true },
  immutable: { immutable: true },
  "br+immutable": { br: true, immutable: true },
  "preload-core": { preload: "core" },
  "preload-all": { preload: "all" },
  all: { br: true, immutable: true, preload: "core" },
};

const COMPRESSIBLE = /\.(glb|wasm|js|json|css|svg)$/i;

/** True for the files a variant recompresses or caches: everything under /sawad/ that is not media. */
export function isAsset(path) {
  return path.startsWith("/sawad/") && !/\.(mp3|jpe?g|png|webp|avif)$/i.test(path);
}

/** The preload set, from a baseline waterfall: /sawad/ files fetched before the live scene, in request order. */
export function preloadSet(waterfall, mode) {
  const files = waterfall.filter((r) => isAsset(new URL(r.url, "http://x").pathname) && r.status === 200);
  const urls = files.map((r) => new URL(r.url, "http://x").pathname);
  if (mode === "all") return urls;
  // core: the first model file and the decoder (what the first frame waits for)
  const firstGlb = urls.find((u) => u.endsWith(".glb"));
  return urls.filter((u) => u === firstGlb || u.startsWith("/sawad/basis/"));
}

/** `Link` header value for a preload set; fetch-type with credentials mode matching three's FileLoader. */
export function linkHeader(urls) {
  return urls.map((u) => `<${u}>; rel=preload; as=fetch; crossorigin=anonymous`).join(", ");
}

const HOP_BY_HOP = ["connection", "keep-alive", "transfer-encoding", "date"];
const brCache = new Map();
const gzCache = new Map();
const rawCache = new Map();

function fetchUpstream(upstream, path, headers) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(upstream + path, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * The front server. `preloadUrls(ua)` returns the hint list for a document request.
 * @param {string} upstream
 * @param {{ br?: boolean, immutable?: boolean, preload?: string }} opts
 * @param {(ua: string) => string[]} [preloadUrls]
 */
export function createFront(upstream, opts, preloadUrls = () => []) {
  const server = createServer(async (req, res) => {
    const path = req.url ?? "/";
    const pathname = path.split("?")[0];
    try {
      if (isAsset(pathname) && req.method === "GET" && !req.headers.range) {
        let raw = rawCache.get(pathname);
        if (!raw) {
          const up = await fetchUpstream(upstream, path, { "accept-encoding": "identity" });
          raw = { status: up.res.statusCode, headers: up.res.headers, body: up.body };
          rawCache.set(pathname, raw);
        }
        const headers = { ...raw.headers };
        for (const h of HOP_BY_HOP) delete headers[h];
        delete headers["content-length"];
        delete headers["content-encoding"];
        delete headers["transfer-encoding"];
        let body = raw.body;
        const ae = String(req.headers["accept-encoding"] ?? "");
        if (opts.br && COMPRESSIBLE.test(pathname) && /\bbr\b/.test(ae)) {
          let b = brCache.get(pathname);
          if (!b) brCache.set(pathname, (b = brotliCompressSync(raw.body, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: raw.body.length } })));
          body = b;
          headers["content-encoding"] = "br";
        } else if (COMPRESSIBLE.test(pathname) && /\bgzip\b/.test(ae)) {
          // what the host does today: gzip at the default level
          let g = gzCache.get(pathname);
          if (!g) gzCache.set(pathname, (g = gzipSync(raw.body)));
          body = g;
          headers["content-encoding"] = "gzip";
        }
        headers.vary = "Accept-Encoding";
        if (opts.immutable) headers["cache-control"] = "public, max-age=31536000, immutable";
        // a revalidation, as the real server answers it (the ETag is the same for every encoding here)
        if (headers.etag && req.headers["if-none-match"] === headers.etag) {
          delete headers["content-length"];
          delete headers["content-encoding"];
          res.writeHead(304, headers);
          res.end();
          return;
        }
        headers["content-length"] = String(body.length);
        res.writeHead(raw.status, headers);
        res.end(body);
        return;
      }
      // everything else streams straight through
      const up = httpRequest(upstream + path, { method: req.method, headers: req.headers }, (ur) => {
        const headers = { ...ur.headers };
        for (const h of HOP_BY_HOP) delete headers[h];
        if (opts.preload && (ur.headers["content-type"] ?? "").startsWith("text/html")) {
          const link = linkHeader(preloadUrls(String(req.headers["user-agent"] ?? "")));
          if (link) headers.link = [headers.link, link].filter(Boolean).join(", ");
        }
        res.writeHead(ur.statusCode ?? 502, headers);
        ur.pipe(res);
      });
      up.on("error", () => res.destroy());
      req.pipe(up);
    } catch {
      res.statusCode = 502;
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ baseUrl: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((r) => server.close(r)) })));
}

/** Requests every /sawad/ asset once (both encodings) so compression cost never lands in a timed load. */
export async function prewarm(baseUrl, urls) {
  for (const u of urls) {
    for (const ae of ["br, gzip", "gzip"]) {
      await new Promise((resolve, reject) => {
        const r = httpRequest(baseUrl + u, { headers: { "accept-encoding": ae } }, (res) => (res.resume(), res.on("end", resolve)));
        r.on("error", reject);
        r.end();
      });
    }
  }
}

/** One page load in an existing page, with every request classified. */
async function loadOnce(page, cdp, baseUrl, route) {
  const reqs = new Map();
  const onSent = (e) => reqs.set(e.requestId, { url: e.request.url.replace(baseUrl, ""), start: e.timestamp, type: e.type, cache: "network" });
  const onResp = (e) => {
    const r = reqs.get(e.requestId);
    if (r) Object.assign(r, { status: e.response.status, fromCache: e.response.fromDiskCache || e.response.fromServiceWorker, encoding: e.response.headers["content-encoding"] ?? "identity" });
  };
  const onCached = (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.cache = "cache";
  };
  const onDone = (e) => {
    const r = reqs.get(e.requestId);
    if (r) Object.assign(r, { end: e.timestamp, bytes: e.encodedDataLength });
  };
  cdp.on("Network.requestWillBeSent", onSent);
  cdp.on("Network.responseReceived", onResp);
  cdp.on("Network.requestServedFromCache", onCached);
  cdp.on("Network.loadingFinished", onDone);
  const t0 = Date.now();
  await page.goto(baseUrl + route, { waitUntil: "load", timeout: 120000 });
  let liveOk = true;
  try {
    await waitForScene(page, { timeoutMs: 120000 });
  } catch {
    liveOk = false;
  }
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => ({ fcp: window.__rig.vitals.fcp, live: window.__rig.startedAt, nav: performance.getEntriesByType("navigation")[0]?.responseStart }));
  void t0;
  cdp.off("Network.requestWillBeSent", onSent);
  cdp.off("Network.responseReceived", onResp);
  cdp.off("Network.requestServedFromCache", onCached);
  cdp.off("Network.loadingFinished", onDone);
  const first = Math.min(...[...reqs.values()].map((r) => r.start));
  const rows = [...reqs.values()].filter((r) => !r.url.startsWith("data:")).map((r) => ({ ...r, start: (r.start - first) * 1000, end: r.end ? (r.end - first) * 1000 : null }));
  const live = liveOk ? m.live : NaN;
  const classed = rows.map((r) => ({ ...r, class: classify(r) }));
  const count = (c) => classed.filter((r) => r.class === c).length;
  return {
    fcpMs: m.fcp,
    liveMs: live,
    requests: classed.length,
    downloaded: count("downloaded"),
    revalidated: count("revalidated"),
    fromCache: count("cache"),
    bytes: classed.reduce((a, r) => a + (r.bytes ?? 0), 0),
    waterfall: classed.sort((a, b) => a.start - b.start),
  };
}

/** A request's fate: served without the network, a conditional round trip (tiny answer), or downloaded. */
export function classify(r) {
  if (r.cache === "cache" || r.fromCache) return "cache";
  if (r.status === 304 || (r.bytes ?? 0) < 600) return "revalidated";
  return "downloaded";
}

export function summarize(runs, key) {
  return { liveMs: median(runs.map((r) => r[key].liveMs)), fcpMs: median(runs.map((r) => r[key].fcpMs)), bytes: median(runs.map((r) => r[key].bytes)), requests: median(runs.map((r) => r[key].requests)), downloaded: median(runs.map((r) => r[key].downloaded)), revalidated: median(runs.map((r) => r[key].revalidated)), fromCache: median(runs.map((r) => r[key].fromCache)) };
}

export function variantTable(results) {
  return mdTable(results, [
    ["Profile", (r) => r.profile],
    ["Variant", (r) => r.variant],
    ["First visit: live scene", (r) => fmtMs(r.first.liveMs)],
    ["First visit: bytes", (r) => fmtBytes(r.first.bytes)],
    ["Repeat: live scene", (r) => fmtMs(r.repeat.liveMs)],
    ["Repeat: bytes", (r) => fmtBytes(r.repeat.bytes)],
    ["Repeat: downloaded / revalidated / from cache", (r) => `${r.repeat.downloaded} / ${r.repeat.revalidated} / ${r.repeat.fromCache}`],
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = list(args.variants) ?? Object.keys(VARIANTS);
  const profiles = list(args.profiles) ?? ["phone", "desktop"];
  const runs = Number(args.runs ?? 3);
  const route = String(args.route ?? "/");
  await withRig("S6-variants", async ({ baseUrl }) => {
    const out = outDirFor("S6-variants");
    // Baseline waterfall (phone and desktop) decides the preload sets.
    const sets = {};
    const browser0 = await launch();
    for (const profile of profiles) {
      const { context, page, cdp } = await openPage(browser0, profile);
      const r = await loadOnce(page, cdp, baseUrl, route);
      sets[profile] = r.waterfall.filter((w) => w.end !== null && w.end <= r.liveMs + 200).filter((w) => w.status === 200);
      await context.close();
    }
    await browser0.close();
    const results = [];
    for (const profile of profiles) {
      for (const name of names) {
        const opts = VARIANTS[name];
        if (!opts) throw new Error(`unknown variant ${name}`);
        const front = await createFront(baseUrl, opts, (ua) => preloadSet(sets[/Mobile/.test(ua) ? "phone" : "desktop"] ?? [], opts.preload));
        await prewarm(front.baseUrl, publicFiles().map((f) => f.url).filter((u) => isAsset(u) && COMPRESSIBLE.test(u)));
        const done = [];
        for (let i = 0; i < runs; i++) {
          const browser = await launch();
          try {
            const { context, page, cdp } = await openPage(browser, profile);
            const first = await loadOnce(page, cdp, front.baseUrl, route);
            const repeat = await loadOnce(page, cdp, front.baseUrl, route);
            done.push({ first, repeat });
            console.log(`[S6] ${profile} ${name} run ${i + 1}: first ${fmtMs(first.liveMs)} ${fmtBytes(first.bytes)}; repeat ${fmtMs(repeat.liveMs)} ${fmtBytes(repeat.bytes)} (${repeat.downloaded} downloaded, ${repeat.revalidated} revalidated, ${repeat.fromCache} cached)`);
            await context.close();
          } finally {
            await browser.close();
          }
        }
        await front.stop();
        results.push({ profile, variant: name, opts, first: summarize(done, "first"), repeat: summarize(done, "repeat"), runs: done });
      }
    }
    const file = saveResult("variants", { takenAt: new Date().toISOString(), route, runs, preloadSets: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, preloadSet(v, "all")])), results }, out);
    console.log(file + "\n\n" + variantTable(results));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((e) => (console.error(e), process.exit(1)));
