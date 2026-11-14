/**
 * Upload validation for media. Pure functions (no Node/Next imports) so they can be
 * unit-tested and reused by the upload Server Action and the local media route.
 *
 * We never trust the browser-supplied MIME type or the file extension: the real type
 * is sniffed from the file's magic bytes. SVG is deliberately NOT allowed (it can carry
 * scripts → stored XSS when served from our origin).
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

export const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
} as const;

export type AllowedImageMime = keyof typeof ALLOWED_IMAGE_TYPES;
export type AllowedImageExt = (typeof ALLOWED_IMAGE_TYPES)[AllowedImageMime];

/** `accept` attribute for <input type="file">. UX only — the server sniffs bytes. */
export const IMAGE_ACCEPT = Object.keys(ALLOWED_IMAGE_TYPES).join(",");

/** Stored local filenames: `<uuid>.<ext>`. Anything else is rejected by the media route. */
export const MEDIA_FILENAME_RE = /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|avif)$/;

const EXT_CONTENT_TYPES: Record<string, AllowedImageMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/** Content-Type for a stored filename's extension, or null if not an allowed image. */
export function contentTypeForFilename(name: string): AllowedImageMime | null {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return EXT_CONTENT_TYPES[ext] ?? null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.length < start + length) return "";
  let out = "";
  for (let i = start; i < start + length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

const AVIF_BRANDS = new Set(["avif", "avis"]);

/** Detect an allowed image type from magic bytes. Returns null for anything else (incl. SVG). */
export function sniffImageType(bytes: Uint8Array): { mime: AllowedImageMime; ext: AllowedImageExt } | null {
  const hit = (mime: AllowedImageMime) => ({ mime, ext: ALLOWED_IMAGE_TYPES[mime] });

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return hit("image/jpeg");
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return hit("image/png");
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return hit("image/gif");
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return hit("image/webp");

  // ISO-BMFF: [size:4]["ftyp"][major brand:4][minor version:4][compatible brands:4*n]
  if (ascii(bytes, 4, 4) === "ftyp") {
    const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
    if (AVIF_BRANDS.has(ascii(bytes, 8, 4))) return hit("image/avif");
    const end = Math.min(boxSize, bytes.length, 256);
    for (let i = 16; i + 4 <= end; i += 4) {
      if (AVIF_BRANDS.has(ascii(bytes, i, 4))) return hit("image/avif");
    }
  }
  return null;
}

/**
 * Safe display filename: basename only, no path separators/control chars, limited
 * charset and length, with the extension forced to the sniffed type.
 */
export function sanitizeFilename(name: string, ext: AllowedImageExt): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/\.[^.]*$/, "") // drop the claimed extension
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.+/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${base || "image"}.${ext}`;
}

export type ImageUploadCheck =
  | { ok: true; mime: AllowedImageMime; ext: AllowedImageExt; filename: string }
  | { ok: false; error: string };

/** Validate an uploaded file's size and real type. */
export function validateImageUpload(file: { name: string; size: number; bytes: Uint8Array }): ImageUploadCheck {
  if (file.size <= 0 || file.bytes.byteLength === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_UPLOAD_BYTES || file.bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Images must be 8 MB or smaller." };
  }
  const type = sniffImageType(file.bytes);
  if (!type) return { ok: false, error: "Only JPEG, PNG, WebP, GIF or AVIF images are allowed." };
  return { ok: true, ...type, filename: sanitizeFilename(file.name, type.ext) };
}
