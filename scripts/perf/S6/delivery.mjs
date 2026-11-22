#!/usr/bin/env node
/**
 * Delivery audit (S6). Two parts, both on the rig's production build of this checkout:
 *
 *   node scripts/perf/S6/delivery.mjs headers   what the server sends for each kind of file
 *   node scripts/perf/S6/delivery.mjs matcher   which public files `proxy.ts` runs on (no server)
 *
 * `headers` requests each URL with `Accept-Encoding: br, gzip`, then with `gzip` only, then
 * conditionally (If-None-Match / If-Modified-Since), and reports status, encoding, size on the wire,
 * Cache-Control, validators and Link. Nothing here changes product code.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { request as httpRequest } from "node:http";
import { pathToFileURL } from "node:url";
import { REPO_DIR, fmtBytes, mdTable, parseArgs, saveResult } from "../lib.mjs";
import { outDirFor, withRig } from "../rig.mjs";

/** Files under public/ with their size, for choosing what to probe. */
export function publicFiles(dir = join(REPO_DIR, "public")) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else out.push({ url: "/" + relative(dir, p).split("\\").join("/"), bytes: s.size });
    }
  };
  walk(dir);
  return out;
}

/** The extension class the audit groups by. */
export function kindOf(url) {
  const m = /\.([a-z0-9]+)$/i.exec(url.split("?")[0]);
  return m ? m[1].toLowerCase() : "(none)";
}

/** The matcher regex of proxy.ts, read from its source so the audit follows the file. */
export function proxyMatcher(source = readFileSync(join(REPO_DIR, "proxy.ts"), "utf8")) {
  const m = /matcher:\s*\[\s*(?:\/\/[^\n]*\n\s*)*"([^"\n]+)"/.exec(source);
  if (!m) throw new Error("no matcher string found in proxy.ts");
  // The source is a normal JS string, so "\." there is ".", exactly what Next receives.
  const pattern = new Function(`return "${m[1]}"`)();
  return new RegExp("^" + pattern + "$");
}

/** Which of the given URLs the proxy runs for. */
export function proxied(urls, matcher = proxyMatcher()) {
  return urls.filter((u) => matcher.test(u));
}

/** One probe of a URL: headers as a plain object plus the bytes on the wire (not decoded). */
export function probe(baseUrl, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(baseUrl + url, { headers: { Connection: "close", ...headers } }, (res) => {
      let bytes = 0;
      res.on("data", (c) => (bytes += c.length));
      res.on("end", () => {
        const h = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]));
        resolve({ url, status: res.statusCode, headers: h, wireBytes: bytes, encoding: h["content-encoding"] ?? "identity" });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** Conditional request built from a first answer's validators. */
export function conditionalHeaders(first) {
  const h = {};
  if (first.headers.etag) h["If-None-Match"] = first.headers.etag;
  else if (first.headers["last-modified"]) h["If-Modified-Since"] = first.headers["last-modified"];
  return h;
}

/** Median time to the last byte over `n` sequential requests (ms), for comparing two small files. */
export async function medianLatency(baseUrl, url, n = 200) {
  const times = [];
  for (let i = 0; i < n + 20; i++) {
    const t = performance.now();
    await probe(baseUrl, url, { "Accept-Encoding": "identity" });
    if (i >= 20) times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

export const PROBES = [
  "/",
  "/ar",
  "/sawad/models/compound-zaitun-far-low.glb",
  "/sawad/models/compound-zaitun-high.glb",
  "/sawad/models/vegetation-high.glb",
  "/sawad/models/life-high.glb",
  "/sawad/models/compound-zaitun.manifest.json",
  "/sawad/lightmaps/zaitun/lightmaps.json",
  "/sawad/basis/basis_transcoder.wasm",
  "/sawad/basis/basis_transcoder.js",
  "/sawad/audio/with-these-hands.mp3",
  "/sawad/scene-zaitun-aerial.jpg",
  "/robots.txt",
];

export async function auditHeaders(baseUrl, extra = []) {
  const urls = [...PROBES, ...extra];
  const rows = [];
  for (const url of urls) {
    const br = await probe(baseUrl, url, { "Accept-Encoding": "br, gzip" });
    const gz = await probe(baseUrl, url, { "Accept-Encoding": "gzip" });
    const cond = br.status === 200 ? await probe(baseUrl, url, { "Accept-Encoding": "br, gzip", ...conditionalHeaders(br) }) : null;
    const range = br.status === 200 ? await probe(baseUrl, url, { Range: "bytes=0-99", "Accept-Encoding": "identity" }) : null;
    rows.push({
      url,
      status: br.status,
      encodingWithBr: br.encoding,
      wireWithBr: br.wireBytes,
      encodingGzipOnly: gz.encoding,
      wireGzipOnly: gz.wireBytes,
      cacheControl: br.headers["cache-control"] ?? null,
      etag: br.headers.etag ?? null,
      lastModified: br.headers["last-modified"] ?? null,
      vary: br.headers.vary ?? null,
      link: br.headers.link ?? null,
      acceptRanges: br.headers["accept-ranges"] ?? null,
      revalidate: cond ? cond.status : null,
      rangeStatus: range ? range.status : null,
      contentType: br.headers["content-type"] ?? null,
    });
  }
  return rows;
}

export function headersTable(rows) {
  return mdTable(rows, [
    ["URL", (r) => "`" + r.url + "`"],
    ["Status", (r) => r.status],
    ["With br offered", (r) => `${r.encodingWithBr}, ${fmtBytes(r.wireWithBr)}`],
    ["Gzip only", (r) => `${r.encodingGzipOnly}, ${fmtBytes(r.wireGzipOnly)}`],
    ["Cache-Control", (r) => (r.cacheControl ? "`" + r.cacheControl + "`" : "none")],
    ["Validators", (r) => [r.etag ? "ETag" : null, r.lastModified ? "Last-Modified" : null].filter(Boolean).join(" + ") || "none"],
    ["Conditional", (r) => r.revalidate ?? "–"],
    ["Range", (r) => r.rangeStatus ?? "–"],
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] ?? "headers";
  if (cmd === "matcher") {
    const files = publicFiles();
    const hit = proxied(files.map((f) => f.url));
    const bytes = files.filter((f) => hit.includes(f.url));
    const byKind = {};
    for (const f of bytes) {
      const k = (byKind[kindOf(f.url)] ??= { count: 0, bytes: 0 });
      k.count++;
      k.bytes += f.bytes;
    }
    console.log(mdTable(Object.entries(byKind), [["Extension", ([k]) => k], ["Files the proxy runs for", ([, v]) => v.count], ["Size", ([, v]) => fmtBytes(v.bytes)]]));
    return;
  }
  if (cmd === "proxycost") {
    // A small file the proxy runs for against a small one it skips, same server, local mode.
    await withRig("S6-proxycost", async ({ baseUrl }) => {
      const pairs = [["/sawad/models/compound.manifest.json", "/file.svg"]];
      for (const [through, around] of pairs) {
        const a = await medianLatency(baseUrl, through);
        const b = await medianLatency(baseUrl, around);
        console.log(`through proxy.ts ${through}: ${a.toFixed(2)} ms; skipped ${around}: ${b.toFixed(2)} ms; difference ${(a - b).toFixed(2)} ms`);
      }
    });
    return;
  }
  await withRig("S6-headers", async ({ baseUrl }) => {
    const rows = await auditHeaders(baseUrl);
    const file = saveResult("headers", { takenAt: new Date().toISOString(), rows }, outDirFor("S6-headers"));
    console.log(file + "\n\n" + headersTable(rows));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((e) => (console.error(e), process.exit(1)));
