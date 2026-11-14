"use server";

/**
 * Server Actions for the inline editor (components/editable).
 *
 * Every action:
 *  1. authorizes with requirePermission() (never trust the UI),
 *  2. validates its input with zod (inputs are typed `unknown` on purpose),
 *  3. returns a typed result — never throws to the client, never leaks stacks.
 */
import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { z } from "zod";
import { AuthError, requirePermission } from "@/lib/auth/guards";
import { getData } from "@/lib/data";
import type { MediaRecord, RevisionRecord } from "@/lib/data/types";
import { MAX_UPLOAD_BYTES, validateImageUpload } from "@/lib/media/validate";
import { safeRelativePath } from "@/components/editable/paths";
import { GLOBAL_SCOPE, blockChangeSchema, blockKeySchema, scopeSchema, type Scope } from "./schemas";
import { tags } from "./tags";

export type ActionError = { ok: false; error: string; code?: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID" | "NOT_FOUND" };
export type ActionResult<T extends object = object> = ({ ok: true } & T) | ActionError;

class NotFoundError extends Error {}

function fail(err: unknown): ActionError {
  if (err instanceof AuthError) return { ok: false, error: err.message, code: err.code };
  if (err instanceof z.ZodError) {
    const issue = err.issues[0];
    return { ok: false, error: issue ? `Invalid input: ${issue.message}` : "Invalid input", code: "INVALID" };
  }
  if (err instanceof NotFoundError) return { ok: false, error: err.message, code: "NOT_FOUND" };
  console.error("[editor action]", err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

const scopesSchema = z.array(scopeSchema).min(1).max(20);

/** Every non-global scope must be the id of an existing page. */
async function assertScopesExist(scopes: Iterable<Scope>) {
  const data = getData();
  const ids = [...new Set(scopes)].filter((s) => s !== GLOBAL_SCOPE);
  const pages = await Promise.all(ids.map((id) => data.getPageById(id)));
  if (pages.some((p) => !p)) throw new NotFoundError("Unknown page");
}

// ───────────────────────── drafts ─────────────────────────

export async function saveDrafts(changes: unknown): Promise<ActionResult<{ saved: number }>> {
  try {
    const user = await requirePermission("content:edit");
    const parsed = z.array(blockChangeSchema).max(500).parse(changes);
    if (parsed.length === 0) return { ok: true, saved: 0 };
    // Last write wins for duplicate keys within one batch.
    const deduped = [...new Map(parsed.map((c) => [`${c.scope}:${c.key}`, c])).values()];
    await assertScopesExist(deduped.map((c) => c.scope));
    await getData().saveDrafts(deduped, user.id);
    return { ok: true, saved: deduped.length };
  } catch (err) {
    return fail(err);
  }
}

const publishInputSchema = z.object({
  scopes: scopesSchema,
  /** Also flip this page from draft → published. */
  publishPageId: z.string().uuid().optional(),
});

export async function publishContent(
  input: unknown,
): Promise<ActionResult<{ published: number; pagePublished: boolean }>> {
  try {
    const user = await requirePermission("content:publish");
    const { scopes, publishPageId } = publishInputSchema.parse(input);
    // Publishing the page itself (status → published) is a page-management action too.
    if (publishPageId) await requirePermission("pages:manage");
    const unique = [...new Set(scopes)];
    await assertScopesExist(unique);
    const data = getData();
    const published = await data.publish(unique, user.id);
    for (const scope of unique) updateTag(tags.content(scope));

    let pagePublished = false;
    if (publishPageId) {
      const page = await data.getPageById(publishPageId);
      if (!page) throw new NotFoundError("Unknown page");
      if (page.status !== "published") {
        await data.updatePage(publishPageId, { status: "published" }, user.id);
        pagePublished = true;
      }
      updateTag(tags.pages);
      updateTag(tags.page(publishPageId));
    }
    return { ok: true, published, pagePublished };
  } catch (err) {
    return fail(err);
  }
}

export async function discardDrafts(scopes: unknown): Promise<ActionResult> {
  try {
    await requirePermission("content:edit");
    const parsed = [...new Set(scopesSchema.parse(scopes))];
    await assertScopesExist(parsed);
    await getData().discardDrafts(parsed);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ───────────────────────── revisions ─────────────────────────

export type RevisionSummary = Pick<RevisionRecord, "id" | "createdAt" | "content">;

export async function listBlockRevisions(
  scope: unknown,
  key: unknown,
): Promise<ActionResult<{ revisions: RevisionSummary[] }>> {
  try {
    await requirePermission("content:edit");
    const s = scopeSchema.parse(scope);
    const k = blockKeySchema.parse(key);
    await assertScopesExist([s]);
    const revisions = await getData().listRevisions(s, k, 20);
    return {
      ok: true,
      revisions: revisions.map((r) => ({ id: r.id, createdAt: r.createdAt, content: r.content })),
    };
  } catch (err) {
    return fail(err);
  }
}

export async function restoreRevision(revisionId: unknown): Promise<ActionResult> {
  try {
    const user = await requirePermission("content:edit");
    const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9-]+$/).parse(revisionId);
    await getData().restoreRevision(id, user.id);
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message) && !(err instanceof AuthError)) {
      return { ok: false, error: "Revision not found", code: "NOT_FOUND" };
    }
    return fail(err);
  }
}

// ───────────────────────── media ─────────────────────────

const dimension = z.coerce.number().int().positive().max(20_000).optional();
const uploadFieldsSchema = z.object({
  alt: z.string().max(500).default(""),
  width: dimension,
  height: dimension,
});

export async function uploadMedia(formData: FormData): Promise<ActionResult<{ media: MediaRecord }>> {
  try {
    const user = await requirePermission("media:manage");
    if (!(formData instanceof FormData)) return { ok: false, error: "Invalid upload", code: "INVALID" };
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "No file selected", code: "INVALID" };
    if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Images must be 8 MB or smaller.", code: "INVALID" };

    const str = (name: string) => {
      const v = formData.get(name);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    const fields = uploadFieldsSchema.parse({ alt: str("alt"), width: str("width"), height: str("height") });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = validateImageUpload({ name: file.name, size: file.size, bytes });
    if (!check.ok) return { ok: false, error: check.error, code: "INVALID" };

    const media = await getData().uploadMedia(
      { name: check.filename, type: check.mime, bytes, width: fields.width, height: fields.height },
      fields.alt,
      user.id,
    );
    updateTag(tags.media);
    return { ok: true, media };
  } catch (err) {
    return fail(err);
  }
}

// ───────────────────────── edit mode ─────────────────────────

/** Turns Draft Mode off and navigates back to the (published) page. */
export async function exitEditMode(path: unknown): Promise<ActionError> {
  const target = safeRelativePath(path) ?? "/";
  try {
    await requirePermission("content:edit");
    (await draftMode()).disable();
  } catch (err) {
    return fail(err);
  }
  redirect(target);
}
