import { describe, expect, it } from "vitest";
import { parseGlb } from "./glb-cost.mjs";
import { dropGlbImageMips, dropTopMips, readKtx2 } from "./ktx2-mip.mjs";
import { writeGlb } from "./strip-glb.mjs";

/**
 * A minimal KTX2: `levels` levels of a w×h texture, level i filled with byte (i + 1), stored
 * smallest first. BasisLZ gets a global-data block with one 20-byte descriptor per level.
 */
function sampleKtx2({ width = 8, height = 4, levels = 3, basis = false } = {}) {
  const dfd = Buffer.alloc(44, 0xdd);
  const kvd = Buffer.alloc(12, 0xee);
  const sgd = basis ? Buffer.concat([Buffer.alloc(20, 0xaa), ...Array.from({ length: levels }, (_, i) => Buffer.alloc(20, 0x10 + i)), Buffer.alloc(8, 0xbb)]) : Buffer.alloc(0);
  const lengths = Array.from({ length: levels }, (_, i) => 16 >> i || 1);
  let o = 80 + levels * 24;
  const dfdOff = o;
  o += dfd.length;
  const kvdOff = o;
  o += kvd.length;
  let sgdOff = 0;
  if (sgd.length) {
    o = (o + 7) & ~7;
    sgdOff = o;
    o += sgd.length;
  }
  const offsets: number[] = new Array(levels);
  for (let i = levels - 1; i >= 0; i--) {
    o = Math.ceil(o / 16) * 16;
    offsets[i] = o;
    o += lengths[i];
  }
  const buf = Buffer.alloc(o);
  buf.write("«KTX 20»\r\n\x1A\n", 0, "latin1");
  buf.writeUInt32LE(width, 20);
  buf.writeUInt32LE(height, 24);
  buf.writeUInt32LE(1, 36);
  buf.writeUInt32LE(levels, 40);
  buf.writeUInt32LE(basis ? 1 : 0, 44);
  buf.writeUInt32LE(dfdOff, 48);
  buf.writeUInt32LE(dfd.length, 52);
  buf.writeUInt32LE(kvdOff, 56);
  buf.writeUInt32LE(kvd.length, 60);
  buf.writeBigUInt64LE(BigInt(sgdOff), 64);
  buf.writeBigUInt64LE(BigInt(sgd.length), 72);
  for (let i = 0; i < levels; i++) {
    buf.writeBigUInt64LE(BigInt(offsets[i]), 80 + i * 24);
    buf.writeBigUInt64LE(BigInt(lengths[i]), 88 + i * 24);
    buf.writeBigUInt64LE(BigInt(lengths[i]), 96 + i * 24);
    buf.fill(i + 1, offsets[i], offsets[i] + lengths[i]);
  }
  dfd.copy(buf, dfdOff);
  kvd.copy(buf, kvdOff);
  sgd.copy(buf, sgdOff);
  return buf;
}

const levelBytes = (buf: Buffer, i: number) => {
  const h = readKtx2(buf);
  return buf.subarray(h.levels[i].offset, h.levels[i].offset + h.levels[i].length);
};

describe("ktx2-mip", () => {
  it("drops the top level of an uncompressed-index (UASTC-style) file and halves its size", () => {
    const src = sampleKtx2();
    const out = dropTopMips(src, 1);
    const h = readKtx2(out);
    expect([h.width, h.height, h.levelCount]).toEqual([4, 2, 2]);
    expect([...levelBytes(out, 0)]).toEqual([...levelBytes(src, 1)]);
    expect([...levelBytes(out, 1)]).toEqual([...levelBytes(src, 2)]);
    expect(out.subarray(h.dfdOffset, h.dfdOffset + h.dfdLength).equals(Buffer.alloc(44, 0xdd))).toBe(true);
    expect(out.length).toBeLessThan(src.length);
  });

  it("removes the dropped level's image descriptor from BasisLZ global data", () => {
    const out = dropTopMips(sampleKtx2({ basis: true }), 1);
    const h = readKtx2(out);
    const sgd = out.subarray(h.sgdOffset, h.sgdOffset + h.sgdLength);
    expect(sgd.length).toBe(20 + 2 * 20 + 8);
    expect(sgd[20]).toBe(0x11); // level 1's descriptor is now first
    expect(sgd[40]).toBe(0x12);
    expect(sgd[sgd.length - 1]).toBe(0xbb);
  });

  it("refuses to drop every level and rejects non-KTX2 input", () => {
    expect(() => dropTopMips(sampleKtx2({ levels: 1 }), 1)).toThrow(/cannot drop/);
    expect(() => readKtx2(Buffer.alloc(100))).toThrow(/not a KTX2/);
  });

  it("replaces a named image inside a GLB and repacks the binary chunk", () => {
    const tex = sampleKtx2();
    const other = Buffer.alloc(8, 9);
    const bin = Buffer.concat([tex, Buffer.alloc((4 - (tex.length % 4)) % 4), other]);
    const json = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: bin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: tex.length },
        { buffer: 0, byteOffset: bin.length - 8, byteLength: 8 },
      ],
      images: [{ name: "atlas", mimeType: "image/ktx2", bufferView: 0 }],
    };
    const out = parseGlb(writeGlb(dropGlbImageMips({ json, bin }, ["atlas"])));
    const v0 = out.json.bufferViews[0];
    expect(readKtx2(out.bin.subarray(v0.byteOffset, v0.byteOffset + v0.byteLength)).width).toBe(4);
    const v1 = out.json.bufferViews[1];
    expect(out.bin.subarray(v1.byteOffset, v1.byteOffset + v1.byteLength).equals(other)).toBe(true);
    expect(() => dropGlbImageMips({ json, bin }, ["nope"])).toThrow(/no image named nope/);
  });
});
