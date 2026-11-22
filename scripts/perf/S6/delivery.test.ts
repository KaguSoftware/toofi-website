import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conditionalHeaders, headersTable, kindOf, medianLatency, probe, proxied, proxyMatcher, publicFiles } from "./delivery.mjs";

describe("proxyMatcher", () => {
  const SOURCE = `export const config = {
  matcher: [
    // Everything except static assets & image optimizer.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg)$).*)",
  ],
};`;

  it("reads the matcher from the proxy source and anchors it", () => {
    const m = proxyMatcher(SOURCE);
    expect(m.test("/")).toBe(true);
    expect(m.test("/sawad/models/a.glb")).toBe(true);
    expect(m.test("/sawad/x.png")).toBe(false);
    expect(m.test("/_next/static/chunk.js")).toBe(false);
  });

  it("throws when proxy.ts has no matcher string", () => {
    expect(() => proxyMatcher("export const x = 1")).toThrow(/no matcher/);
  });

  it("lists the URLs the proxy runs for", () => {
    expect(proxied(["/a.glb", "/b.png", "/c.wasm"], proxyMatcher(SOURCE))).toEqual(["/a.glb", "/c.wasm"]);
  });

  it("matches the real proxy.ts: models, textures and the decoder go through it, images do not", () => {
    const m = proxyMatcher();
    expect(m.test("/sawad/models/compound-zaitun-high.glb")).toBe(true);
    expect(m.test("/sawad/lightmaps/zaitun/day-site-high.ktx2")).toBe(true);
    expect(m.test("/sawad/basis/basis_transcoder.wasm")).toBe(true);
    expect(m.test("/sawad/scene-zaitun-aerial.jpg")).toBe(false);
  });
});

describe("kindOf", () => {
  it("returns the lower-case extension", () => {
    expect(kindOf("/a/B.GLB?x=1")).toBe("glb");
    expect(kindOf("/robots")).toBe("(none)");
  });
});

describe("publicFiles", () => {
  it("walks public/ and reports URL and size", () => {
    const files = publicFiles();
    expect(files.some((f) => f.url === "/sawad/basis/basis_transcoder.wasm" && f.bytes > 0)).toBe(true);
  });
});

describe("probe and conditionalHeaders", () => {
  let base = "";
  const server = createServer((req, res) => {
    if (req.headers["if-none-match"] === '"v1"') {
      res.writeHead(304, { etag: '"v1"' });
      res.end();
      return;
    }
    res.writeHead(200, { etag: '"v1"', "cache-control": "public, max-age=0", "content-type": "text/plain" });
    res.end("hello");
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("reads status, headers and wire bytes", async () => {
    const r = await probe(base, "/x");
    expect(r.status).toBe(200);
    expect(r.wireBytes).toBe(5);
    expect(r.encoding).toBe("identity");
    expect(r.headers["cache-control"]).toBe("public, max-age=0");
  });

  it("builds a conditional request that the server answers with 304", async () => {
    const first = await probe(base, "/x");
    const cond = conditionalHeaders(first);
    expect(cond).toEqual({ "If-None-Match": '"v1"' });
    expect((await probe(base, "/x", cond)).status).toBe(304);
  });

  it("takes the median latency of sequential requests", async () => {
    const ms = await medianLatency(base, "/x", 5);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(1000);
  });

  it("falls back to Last-Modified and to nothing", () => {
    expect(conditionalHeaders({ headers: { "last-modified": "Mon" } })).toEqual({ "If-Modified-Since": "Mon" });
    expect(conditionalHeaders({ headers: {} })).toEqual({});
  });
});

describe("headersTable", () => {
  it("renders one row per URL", () => {
    const md = headersTable([
      { url: "/a.glb", status: 200, encodingWithBr: "gzip", wireWithBr: 1000, encodingGzipOnly: "gzip", wireGzipOnly: 1000, cacheControl: null, etag: '"x"', lastModified: null, revalidate: 304, rangeStatus: 206 },
    ]);
    expect(md).toContain("`/a.glb`");
    expect(md).toContain("none");
    expect(md).toContain("ETag");
  });
});
