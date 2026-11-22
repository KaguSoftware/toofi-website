import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classify, createFront, isAsset, linkHeader, preloadSet, summarize, variantTable } from "./variants.mjs";
import { probe } from "./delivery.mjs";

describe("isAsset", () => {
  it("is the non-media files under /sawad/", () => {
    expect(isAsset("/sawad/models/a.glb")).toBe(true);
    expect(isAsset("/sawad/basis/basis_transcoder.wasm")).toBe(true);
    expect(isAsset("/sawad/audio/a.mp3")).toBe(false);
    expect(isAsset("/sawad/scene-a.jpg")).toBe(false);
    expect(isAsset("/")).toBe(false);
  });
});

describe("preloadSet and linkHeader", () => {
  const wf = [
    { url: "/sawad/lightmaps/zaitun/lightmaps.json", status: 200 },
    { url: "/sawad/models/compound-zaitun-far-low.glb", status: 200 },
    { url: "/sawad/models/vegetation-low.glb", status: 200 },
    { url: "/sawad/basis/basis_transcoder.wasm", status: 200 },
    { url: "/_next/static/chunk.js", status: 200 },
    { url: "/sawad/models/life-low.glb", status: 304 },
  ];
  it("all: every /sawad/ file answered 200, in request order", () => {
    expect(preloadSet(wf, "all")).toEqual(["/sawad/lightmaps/zaitun/lightmaps.json", "/sawad/models/compound-zaitun-far-low.glb", "/sawad/models/vegetation-low.glb", "/sawad/basis/basis_transcoder.wasm"]);
  });
  it("core: the first model and the decoder", () => {
    expect(preloadSet(wf, "core")).toEqual(["/sawad/models/compound-zaitun-far-low.glb", "/sawad/basis/basis_transcoder.wasm"]);
  });
  it("formats fetch preloads", () => {
    expect(linkHeader(["/a.glb", "/b.wasm"])).toBe("</a.glb>; rel=preload; as=fetch; crossorigin=anonymous, </b.wasm>; rel=preload; as=fetch; crossorigin=anonymous");
    expect(linkHeader([])).toBe("");
  });
});

describe("classify and summarize", () => {
  it("separates cache hits, revalidations and downloads", () => {
    expect(classify({ cache: "cache" })).toBe("cache");
    expect(classify({ cache: "network", fromCache: true, bytes: 0 })).toBe("cache");
    expect(classify({ cache: "network", status: 304, bytes: 200 })).toBe("revalidated");
    expect(classify({ cache: "network", status: 200, bytes: 300 })).toBe("revalidated");
    expect(classify({ cache: "network", status: 200, bytes: 90000 })).toBe("downloaded");
  });
  it("takes medians across runs", () => {
    const run = (live: number) => ({ first: { liveMs: live, fcpMs: 1, bytes: 10, requests: 3, downloaded: 2, revalidated: 1, fromCache: 0 } });
    expect(summarize([run(1), run(3), run(2)], "first").liveMs).toBe(2);
  });
  it("renders the table", () => {
    const s = { liveMs: 1000, fcpMs: 1, bytes: 1000, requests: 1, downloaded: 1, revalidated: 2, fromCache: 3 };
    expect(variantTable([{ profile: "phone", variant: "base", first: s, repeat: s }])).toContain("1 / 2 / 3");
  });
});

describe("front server", () => {
  const body = Buffer.from("x".repeat(5000));
  let upstream = "";
  const up = createServer((req, res) => {
    if (req.url?.startsWith("/sawad/models/m.glb")) {
      res.writeHead(200, { "content-type": "model/gltf-binary", etag: '"e1"', "cache-control": "public, max-age=0" });
      res.end(body);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    }
  });
  beforeAll(async () => {
    await new Promise<void>((r) => up.listen(0, "127.0.0.1", r));
    upstream = `http://127.0.0.1:${(up.address() as AddressInfo).port}`;
  });
  afterAll(() => up.close());

  it("passes through gzip as shipped, brotli when asked, and long cache when asked", async () => {
    const base = await createFront(upstream, {});
    const gz = await probe(base.baseUrl, "/sawad/models/m.glb", { "Accept-Encoding": "br, gzip" });
    expect(gz.encoding).toBe("gzip");
    expect(gz.headers["cache-control"]).toBe("public, max-age=0");
    await base.stop();

    const full = await createFront(upstream, { br: true, immutable: true });
    const br = await probe(full.baseUrl, "/sawad/models/m.glb", { "Accept-Encoding": "br, gzip" });
    expect(br.encoding).toBe("br");
    expect(br.wireBytes).toBeLessThan(gz.wireBytes + 1);
    expect(br.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    void brotliDecompressSync;
    void gunzipSync;
    await full.stop();
  });

  it("answers a matching If-None-Match with 304", async () => {
    const f = await createFront(upstream, {});
    const first = await probe(f.baseUrl, "/sawad/models/m.glb", { "Accept-Encoding": "gzip" });
    const again = await probe(f.baseUrl, "/sawad/models/m.glb", { "Accept-Encoding": "gzip", "If-None-Match": first.headers.etag });
    expect(again.status).toBe(304);
    await f.stop();
  });

  it("adds the preload Link header to documents only when a preload mode is set", async () => {
    const off = await createFront(upstream, {}, () => ["/sawad/models/m.glb"]);
    expect((await probe(off.baseUrl, "/")).headers.link).toBeUndefined();
    await off.stop();
    const on = await createFront(upstream, { preload: "core" }, () => ["/sawad/models/m.glb"]);
    expect((await probe(on.baseUrl, "/")).headers.link).toContain("</sawad/models/m.glb>; rel=preload");
    await on.stop();
  });
});
