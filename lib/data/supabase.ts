import "server-only";
import { randomUUID } from "node:crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { isRole, type Role } from "@/lib/auth/roles";
import type { BlockChange, BlockContent, ContentMap, PageInput, PageStatus, Scope } from "@/lib/content/schemas";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createSupabaseAnonClient, createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BlockRecord,
  ContentMode,
  DataProvider,
  MediaRecord,
  PageRecord,
  RevisionRecord,
  UserRecord,
} from "./types";

/**
 * SupabaseProvider — which Supabase client each method uses
 * ─────────────────────────────────────────────────────────
 *  anon  (cookie-less, publishable key, role `anon`; safe inside "use cache"):
 *    getContent(scope, "published")          → view public.published_content
 *    listPages / getPageBySlug / getPageById → only in the `anon` flavour (see below)
 *  session (cookie client = the signed-in user's JWT; needs request context):
 *    getContent(scope, "draft"), listBlocks, saveDrafts, publish, discardDrafts,
 *    hasUnpublishedChanges, listRevisions, restoreRevision, createPage, updatePage,
 *    deletePage, listMedia, uploadMedia, deleteMedia
 *  admin (secret key, bypasses RLS):
 *    listUsers, setUserRole   (callers must have checked `users:manage`)
 *
 * Page reads come in two flavours because `cookies()` throws inside "use cache":
 *   supabaseProvider        — page reads use the anon client: published pages only
 *                             (RLS guarantees it). Use from cached/public code.
 *   supabaseSessionProvider — page reads use the cookie client: editors also see draft
 *                             pages. Use from admin pages and edit mode (dynamic, uncached).
 * Everything else is identical between the two.
 */

type Db = Database["public"]["Tables"];

const fail = (error: PostgrestError | { message: string }): never => {
  throw new Error(error.message);
};

const isUniqueViolation = (e: PostgrestError) => e.code === "23505";

function toPage(r: Db["pages"]["Row"]): PageRecord {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    template: r.template,
    status: r.status as PageStatus,
    seo: (r.seo ?? {}) as PageRecord["seo"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publishedAt: r.published_at,
  };
}

function toBlock(r: Db["content_blocks"]["Row"]): BlockRecord {
  return {
    id: r.id,
    scope: r.scope as Scope,
    key: r.key,
    type: r.type as BlockRecord["type"],
    draft: (r.draft ?? null) as BlockRecord["draft"],
    published: (r.published ?? null) as BlockRecord["published"],
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

function toRevision(r: Db["content_revisions"]["Row"]): RevisionRecord {
  return {
    id: r.id,
    blockId: r.block_id,
    content: { type: r.type, value: r.value } as BlockContent,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

function toMedia(r: Db["media"]["Row"]): MediaRecord {
  return {
    id: r.id,
    url: r.url,
    filename: r.filename,
    contentType: r.content_type,
    size: Number(r.size),
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    alt: r.alt,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export function createSupabaseProvider(pageReads: "anon" | "session"): DataProvider {
  const pageReadClient = () => (pageReads === "anon" ? createSupabaseAnonClient() : createSupabaseServerClient());

  return {
    // ── pages ──
    async listPages() {
      const { data, error } = await (await pageReadClient()).from("pages").select("*").order("slug");
      if (error) fail(error);
      return (data ?? []).map(toPage).sort((a, b) => a.slug.localeCompare(b.slug));
    },

    async getPageBySlug(slug) {
      const { data, error } = await (await pageReadClient()).from("pages").select("*").eq("slug", slug).maybeSingle();
      if (error) fail(error);
      return data ? toPage(data) : null;
    },

    async getPageById(id) {
      const { data, error } = await (await pageReadClient()).from("pages").select("*").eq("id", id).maybeSingle();
      if (error) fail(error);
      return data ? toPage(data) : null;
    },

    async createPage(input: PageInput, userId) {
      const db = await createSupabaseServerClient();
      const { data, error } = await db
        .from("pages")
        .insert({
          slug: input.slug,
          title: input.title,
          template: input.template,
          status: "draft",
          seo: (input.seo ?? {}) as Json,
          created_by: userId,
        })
        .select()
        .single();
      if (error) {
        if (isUniqueViolation(error)) throw new Error(`A page with slug ${input.slug} already exists`);
        fail(error);
      }
      return toPage(data!);
    },

    async updatePage(id, input: Partial<PageInput> & { status?: PageStatus }) {
      const db = await createSupabaseServerClient();
      const patch: Db["pages"]["Update"] = {
        ...(input.slug !== undefined && { slug: input.slug }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.template !== undefined && { template: input.template }),
        ...(input.seo !== undefined && { seo: input.seo as Json }),
        ...(input.status !== undefined && { status: input.status }),
        updated_at: new Date().toISOString(),
      };
      // published_at is stamped by the pages_stamp_published_at trigger on draft → published.
      const { data, error } = await db.from("pages").update(patch).eq("id", id).select().maybeSingle();
      if (error) {
        if (isUniqueViolation(error)) throw new Error(`A page with slug ${input.slug} already exists`);
        fail(error);
      }
      if (!data) throw new Error("Page not found");
      return toPage(data);
    },

    async deletePage(id) {
      // Blocks + revisions go with it (ON DELETE CASCADE).
      const db = await createSupabaseServerClient();
      const { error } = await db.from("pages").delete().eq("id", id);
      if (error) fail(error);
    },

    // ── content ──
    async getContent(scope: Scope, mode: ContentMode) {
      const map: ContentMap = {};
      if (mode === "published") {
        // anon client + view: never exposes drafts and works inside "use cache".
        const { data, error } = await createSupabaseAnonClient()
          .from("published_content")
          .select("key, type, published")
          .eq("scope", scope);
        if (error) fail(error);
        for (const r of data ?? []) {
          if (r.key && r.type && r.published != null) map[r.key] = { type: r.type, value: r.published } as BlockContent;
        }
        return map;
      }
      const db = await createSupabaseServerClient();
      const { data, error } = await db.from("content_blocks").select("key, type, draft, published").eq("scope", scope);
      if (error) fail(error);
      for (const r of data ?? []) {
        const value = r.draft ?? r.published;
        if (value != null) map[r.key] = { type: r.type, value } as BlockContent;
      }
      return map;
    },

    async listBlocks(scope) {
      const db = await createSupabaseServerClient();
      const { data, error } = await db.from("content_blocks").select("*").eq("scope", scope).order("key");
      if (error) fail(error);
      return (data ?? []).map(toBlock);
    },

    async saveDrafts(changes: BlockChange[]) {
      if (changes.length === 0) return;
      const db = await createSupabaseServerClient();
      const payload = changes.map((c) => ({ scope: c.scope, key: c.key, type: c.type, value: c.value }));
      const { error } = await db.rpc("save_drafts", { changes: payload as unknown as Json });
      if (error) fail(error);
    },

    async publish(scopes) {
      if (scopes.length === 0) return 0;
      const db = await createSupabaseServerClient();
      const { data, error } = await db.rpc("publish_scopes", { scopes });
      if (error) fail(error);
      return data ?? 0;
    },

    async discardDrafts(scopes) {
      if (scopes.length === 0) return;
      const db = await createSupabaseServerClient();
      const { error } = await db.rpc("discard_drafts", { scopes });
      if (error) fail(error);
    },

    async hasUnpublishedChanges(scope) {
      const db = await createSupabaseServerClient();
      const { count, error } = await db
        .from("content_blocks")
        .select("id", { count: "exact", head: true })
        .eq("scope", scope)
        .not("draft", "is", null);
      if (error) fail(error);
      return (count ?? 0) > 0;
    },

    async listRevisions(scope, key, limit = 20) {
      const db = await createSupabaseServerClient();
      const { data: block, error: blockError } = await db
        .from("content_blocks")
        .select("id")
        .eq("scope", scope)
        .eq("key", key)
        .maybeSingle();
      if (blockError) fail(blockError);
      if (!block) return [];
      const { data, error } = await db
        .from("content_revisions")
        .select("*")
        .eq("block_id", block.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) fail(error);
      return (data ?? []).map(toRevision);
    },

    async restoreRevision(revisionId) {
      const db = await createSupabaseServerClient();
      const { error } = await db.rpc("restore_revision", { revision_id: revisionId });
      if (error) fail(error);
    },

    // ── media ──
    async listMedia() {
      const db = await createSupabaseServerClient();
      const { data, error } = await db.from("media").select("*").order("created_at", { ascending: false });
      if (error) fail(error);
      return (data ?? []).map(toMedia);
    },

    async uploadMedia(file, alt, userId) {
      const db = await createSupabaseServerClient();
      const id = randomUUID();
      const ext = (file.name.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0] ?? "").toLowerCase();
      const storagePath = `uploads/${id}${ext}`;
      const bucket = db.storage.from(env.SUPABASE_MEDIA_BUCKET);

      const { error: uploadError } = await bucket.upload(storagePath, file.bytes, {
        contentType: file.type,
        cacheControl: "31536000",
        upsert: false,
      });
      if (uploadError) fail(uploadError);

      const url = bucket.getPublicUrl(storagePath).data.publicUrl;
      const { data, error } = await db
        .from("media")
        .insert({
          id,
          storage_path: storagePath,
          url,
          filename: file.name,
          content_type: file.type,
          size: file.bytes.byteLength,
          width: file.width ?? null,
          height: file.height ?? null,
          alt,
          created_by: userId,
        })
        .select()
        .single();
      if (error) {
        await bucket.remove([storagePath]); // don't leave an orphaned object
        fail(error);
      }
      return toMedia(data!);
    },

    async deleteMedia(id) {
      const db = await createSupabaseServerClient();
      const { data: row, error: readError } = await db.from("media").select("id, storage_path").eq("id", id).maybeSingle();
      if (readError) fail(readError);
      if (!row) return;
      const { error } = await db.from("media").delete().eq("id", id);
      if (error) fail(error);
      const { error: removeError } = await db.storage.from(env.SUPABASE_MEDIA_BUCKET).remove([row.storage_path]);
      if (removeError) fail(removeError);
    },

    // ── users (secret key; callers verified users:manage) ──
    async listUsers() {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.from("profiles").select("*").order("email");
      if (error) fail(error);
      return (data ?? []).map(
        (p): UserRecord => ({
          id: p.id,
          email: p.email,
          name: p.name,
          role: isRole(p.role) ? p.role : "member",
          createdAt: p.created_at,
        }),
      );
    },

    async setUserRole(userId, role: Role) {
      const admin = createSupabaseAdminClient();
      // No end-user JWT here, so the profiles_guard_columns trigger lets the change through.
      const { data, error } = await admin.from("profiles").update({ role }).eq("id", userId).select("id").maybeSingle();
      if (error) fail(error);
      if (!data) throw new Error("User not found");
    },
  };
}

/** Public/cached-safe provider: page reads are anon (published only). */
export const supabaseProvider: DataProvider = createSupabaseProvider("anon");

/** Session-aware provider for admin UI / edit mode: page reads include drafts for editors. Not usable in "use cache". */
export const supabaseSessionProvider: DataProvider = createSupabaseProvider("session");
