import { describe, expect, it } from "vitest";
import { chunkUrls, editorMarkers } from "./served.mjs";

describe("chunkUrls", () => {
  it("lists each chunk once, in order, from tags, preloads and the RSC payload", () => {
    const html = `<link rel="preload" href="/_next/static/chunks/a.js"/><script src="/_next/static/chunks/b.js?dpl=1"></script><script>self.__next_f.push(["static/chunks/a.js","static/chunks/c-d_e.js"])</script>`;
    expect(chunkUrls(html)).toEqual(["static/chunks/a.js", "static/chunks/b.js", "static/chunks/c-d_e.js"]);
  });
  it("returns an empty list for a page with no scripts", () => {
    expect(chunkUrls("<html></html>")).toEqual([]);
  });
});

describe("editorMarkers", () => {
  it("names the admin editor strings a chunk contains", () => {
    expect(editorMarkers("new ProseMirror(); DndContext")).toEqual(["ProseMirror", "DndContext"]);
  });
  it("finds none in ordinary code", () => {
    expect(editorMarkers("function render(){}")).toEqual([]);
  });
});
