import { promises as fs } from "node:fs";
import path from "node:path";
import { backendMode } from "@/lib/env";
import { LOCAL_UPLOAD_DIR } from "@/lib/data/local";
import { MEDIA_FILENAME_RE, contentTypeForFilename } from "@/lib/media/validate";

/**
 * GET /api/media/<uuid>.<ext> — serves uploads in LOCAL backend mode only
 * (Supabase mode serves media from Storage). Public, like any published image.
 *
 * Path traversal: exactly one segment, matched against a strict uuid.ext regex,
 * and the resolved path is re-checked to sit directly inside LOCAL_UPLOAD_DIR.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (backendMode !== "local") return notFound();

  const segments = (await params).path;
  if (segments.length !== 1) return notFound();
  const name = segments[0];
  if (!MEDIA_FILENAME_RE.test(name)) return notFound();
  const contentType = contentTypeForFilename(name);
  if (!contentType) return notFound();

  const filePath = path.join(LOCAL_UPLOAD_DIR, name);
  if (path.dirname(filePath) !== path.resolve(LOCAL_UPLOAD_DIR)) return notFound();

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    return notFound();
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Filenames are random UUIDs and never reused → safe to cache forever.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" },
  });
}
