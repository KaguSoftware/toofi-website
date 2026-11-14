import { describe, expect, it } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  MEDIA_FILENAME_RE,
  contentTypeForFilename,
  sanitizeFilename,
  sniffImageType,
  validateImageUpload,
} from "./validate";

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], "IHDR");
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], "JFIF");
const GIF = bytes("GIF89a", [1, 0, 1, 0]);
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const AVIF = bytes([0, 0, 0, 0x1c], "ftyp", "avif", [0, 0, 0, 0], "avif", "mif1", "miaf");
const AVIF_COMPAT = bytes([0, 0, 0, 0x1c], "ftyp", "mif1", [0, 0, 0, 0], "mif1", "avif", "miaf");
const HEIC = bytes([0, 0, 0, 0x18], "ftyp", "heic", [0, 0, 0, 0], "mif1", "heic");
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const SVG_BOM = bytes([0xef, 0xbb, 0xbf], "<?xml version=\"1.0\"?><svg/>");
const HTML = bytes("<!doctype html><script>alert(1)</script>");

describe("sniffImageType", () => {
  it.each([
    ["png", PNG, "image/png"],
    ["jpeg", JPEG, "image/jpeg"],
    ["gif", GIF, "image/gif"],
    ["webp", WEBP, "image/webp"],
    ["avif (major brand)", AVIF, "image/avif"],
    ["avif (compatible brand)", AVIF_COMPAT, "image/avif"],
  ])("detects %s", (_name, data, mime) => {
    expect(sniffImageType(data)?.mime).toBe(mime);
  });

  it.each([
    ["svg", SVG],
    ["svg with BOM", SVG_BOM],
    ["html", HTML],
    ["heic", HEIC],
    ["empty", new Uint8Array()],
    ["truncated png", PNG.slice(0, 4)],
    ["RIFF but not webp", bytes("RIFF", [0, 0, 0, 0], "WAVE")],
  ])("rejects %s", (_name, data) => {
    expect(sniffImageType(data)).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("forces the sniffed extension", () => {
    expect(sanitizeFilename("photo.svg", "png")).toBe("photo.png");
    expect(sanitizeFilename("x.php.jpg", "jpg")).toBe("x.php.jpg");
  });
  it("strips paths and unsafe characters", () => {
    expect(sanitizeFilename("../../etc/passwd", "png")).toBe("passwd.png");
    expect(sanitizeFilename("C:\\Users\\me\\My Photo (1).JPG", "jpg")).toBe("My-Photo-1.jpg");
    expect(sanitizeFilename('<img src=x onerror="a">.gif', "gif")).not.toMatch(/[<>"= ]/);
  });
  it("falls back to a default name", () => {
    expect(sanitizeFilename("...", "webp")).toBe("image.webp");
    expect(sanitizeFilename("", "avif")).toBe("image.avif");
  });
  it("limits length", () => {
    expect(sanitizeFilename("a".repeat(500) + ".png", "png").length).toBeLessThanOrEqual(84);
  });
});

describe("validateImageUpload", () => {
  it("accepts a real png regardless of claimed name", () => {
    const r = validateImageUpload({ name: "evil.svg", size: PNG.length, bytes: PNG });
    expect(r).toEqual({ ok: true, mime: "image/png", ext: "png", filename: "evil.png" });
  });
  it("rejects svg even when named .png", () => {
    expect(validateImageUpload({ name: "cat.png", size: SVG.length, bytes: SVG }).ok).toBe(false);
  });
  it("rejects empty files", () => {
    expect(validateImageUpload({ name: "a.png", size: 0, bytes: new Uint8Array() }).ok).toBe(false);
  });
  it("rejects files over 8 MB", () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PNG);
    expect(validateImageUpload({ name: "a.png", size: big.length, bytes: big }).ok).toBe(false);
    const ok = new Uint8Array(MAX_UPLOAD_BYTES);
    ok.set(PNG);
    expect(validateImageUpload({ name: "a.png", size: ok.length, bytes: ok }).ok).toBe(true);
  });
});

describe("media filenames", () => {
  it("only matches uuid.ext basenames", () => {
    expect(MEDIA_FILENAME_RE.test("3f2b8c1e-1234-4abc-9def-0123456789ab.png")).toBe(true);
    expect(MEDIA_FILENAME_RE.test("../3f2b8c1e-1234-4abc-9def-0123456789ab.png")).toBe(false);
    expect(MEDIA_FILENAME_RE.test("3f2b8c1e-1234-4abc-9def-0123456789ab.svg")).toBe(false);
    expect(MEDIA_FILENAME_RE.test("3f2b8c1e-1234-4abc-9def-0123456789ab.png/x")).toBe(false);
  });
  it("maps content types", () => {
    expect(contentTypeForFilename("a.jpeg")).toBe("image/jpeg");
    expect(contentTypeForFilename("a.avif")).toBe("image/avif");
    expect(contentTypeForFilename("a.svg")).toBeNull();
  });
});
