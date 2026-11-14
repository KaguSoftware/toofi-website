// Generates lightweight raster placeholders (PNG) into public/placeholders using only node:zlib.
// Run: node scripts/gen-placeholders.mjs   (outputs are committed; re-run only to change them)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 1; // filter: Sub (smooth gradients compress very well)
    let prev = [0, 0, 0];
    for (let x = 0; x < w; x++) {
      const px = pixel(x / (w - 1), y / (h - 1));
      for (let i = 0; i < 3; i++) {
        raw[row + 1 + x * 3 + i] = (px[i] - prev[i]) & 255;
      }
      prev = px;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const blob = (x, y, cx, cy, r) => Math.max(0, 1 - Math.hypot(x - cx, y - cy) / r) ** 2;

// Soft light-neutral mesh with a whisper of the accent blue.
function mesh(base, tintA, tintB) {
  return (x, y) => {
    let p = base;
    p = mix(p, tintA, Math.min(1, blob(x, y, 0.2, 0.25, 0.7) * 0.9));
    p = mix(p, tintB, Math.min(1, blob(x, y, 0.85, 0.8, 0.75) * 0.8));
    return p;
  };
}

mkdirSync("public/placeholders", { recursive: true });
writeFileSync("public/placeholders/hero.png", png(1280, 720, mesh([236, 238, 244], [180, 210, 250], [226, 214, 240])));
writeFileSync("public/placeholders/feature.png", png(800, 800, mesh([240, 241, 245], [200, 222, 252], [232, 226, 244])));
