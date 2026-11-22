import { afterEach, describe, expect, it } from "vitest";
import { answer, mockSupabase, parseQuery, seedRows, timeRequest } from "./lib.mjs";

describe("S7 lib", () => {
  it("parses a PostgREST URL into table and eq filters", () => {
    const q = parseQuery("/rest/v1/pages?select=*&slug=eq.%2Fabout");
    expect(q.table).toBe("pages");
    expect(q.eq).toEqual({ slug: "/about" });
  });

  it("answers from the seed rows", () => {
    const rows = seedRows();
    expect(answer(rows, { table: "pages", eq: { slug: "/" } })).toHaveLength(1);
    expect(answer(rows, { table: "published_content", eq: { scope: "global" } }).length).toBeGreaterThan(0);
    expect(answer(rows, { table: "nope", eq: {} })).toEqual([]);
  });

  describe("mock server", () => {
    let mock: ReturnType<typeof mockSupabase> | null = null;
    afterEach(async () => {
      await mock?.stop();
      mock = null;
    });

    it("counts queries per table and answers maybeSingle with an object or a 406", async () => {
      mock = mockSupabase({ port: 54391, latencyMs: 1 });
      await mock.start();
      const ok = await fetch("http://127.0.0.1:54391/rest/v1/pages?slug=eq./", { headers: { accept: "application/vnd.pgrst.object+json" } });
      expect(ok.status).toBe(200);
      expect((await ok.json()).slug).toBe("/");
      const miss = await fetch("http://127.0.0.1:54391/rest/v1/pages?slug=eq./zzz", { headers: { accept: "application/vnd.pgrst.object+json" } });
      expect(miss.status).toBe(406);
      expect(mock.byTable()).toEqual({ pages: 2 });
      mock.reset();
      expect(mock.log).toHaveLength(0);
    });

    it("times a streamed response and finds the marker", async () => {
      mock = mockSupabase({ port: 54392, latencyMs: 1 });
      await mock.start();
      const r = await timeRequest("http://127.0.0.1:54392/rest/v1/pages", { marker: "slug" });
      expect(r.status).toBe(200);
      expect(r.markerAt).not.toBeNull();
      expect(r.total).toBeGreaterThanOrEqual(r.ttfb);
    });
  });
});

import { imageUrls, report } from "./request.mjs";

describe("S7 request report", () => {
  it("finds optimizer URLs in src and srcset and unescapes them", () => {
    const html = '<img src="/_next/image?url=%2Fa.jpg&amp;w=1200&amp;q=75" srcset="/_next/image?url=%2Fa.jpg&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fa.jpg&amp;w=1200&amp;q=75 1200w">';
    expect(imageUrls(html)).toEqual(["/_next/image?url=%2Fa.jpg&w=1200&q=75", "/_next/image?url=%2Fa.jpg&w=640&q=75"]);
  });

  it("renders a table with values, not blanks", () => {
    const page = { path: "/", status: 200, bytes: 2048, first: { ttfb: 4, content: 5, total: 6 }, ttfbMedian: 3, ttfbP95: 4, contentMedian: 3.5, totalMedian: 5, headers: { "cache-control": "x" } };
    const md = report({ local: { pages: [page], files: [], images: [] } });
    expect(md).toContain("| / | 200 | 2 |");
    expect(md).toContain("3.0 ms");
  });
});
