import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPRESSIBLE, filesTable, imageSize, ktx2Size, meshTable, walk } from "./assets.mjs";

describe("headers", () => {
  it("reads a KTX2 header", () => {
    const buf = Buffer.alloc(48);
    buf.write("«KTX 20»\r\n\x1A\n", 0, "latin1");
    buf.writeUInt32LE(2048, 20);
    buf.writeUInt32LE(1024, 24);
    buf.writeUInt32LE(12, 40);
    buf.writeUInt32LE(1, 44);
    expect(ktx2Size(buf)).toEqual({ width: 2048, height: 1024, levels: 12, supercompression: 1 });
    expect(ktx2Size(Buffer.from("not a ktx2 file at all, really not"))).toBeNull();
  });

  it("reads PNG and JPEG sizes", () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(1920, 16);
    png.writeUInt32BE(1080, 20);
    expect(imageSize(png)).toEqual({ width: 1920, height: 1080 });
    // SOI, an APP0 segment of length 4, then SOF0 with height 600 and width 800
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20]);
    expect(imageSize(jpg)).toEqual({ width: 800, height: 600 });
    expect(imageSize(Buffer.from([1, 2, 3]))).toBeNull();
  });
});

describe("files", () => {
  it("walks folders and treats only compressible types as such", () => {
    const dir = mkdtempSync(join(tmpdir(), "rig-assets-"));
    mkdirSync(join(dir, "a/b"), { recursive: true });
    writeFileSync(join(dir, "a/b/x.glb"), "x");
    writeFileSync(join(dir, "y.jpg"), "y");
    expect(walk(dir).map((p) => p.slice(dir.length + 1)).sort()).toEqual(["a/b/x.glb", "y.jpg"]);
    rmSync(dir, { recursive: true, force: true });
    expect(COMPRESSIBLE.has(".glb")).toBe(true);
    expect(COMPRESSIBLE.has(".mp3")).toBe(false);
  });

  it("formats the file and mesh tables", () => {
    expect(filesTable([{ file: "m.glb", raw: 10_260_000, gzip: 7_140_000, brotli: 6_790_000 }])).toContain("| m.glb | 10.26 MB | 7.14 MB | 6.79 MB |  |");
    expect(meshTable([{ name: "villa", triangles: 1000, copies: 60, trianglesPlaced: 60000, decodedBytes: 2048 }])).toContain("| villa | 1,000 | 60 | 60,000 | 2.0 KB |");
  });
});
