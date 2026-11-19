import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Role } from "@/lib/auth/roles";
import {
  blockContentSchema,
  GLOBAL_SCOPE,
  type BlockChange,
  type BlockContent,
  type ContentMap,
  type PageInput,
  type PageStatus,
  type Scope,
} from "@/lib/content/schemas";
import type {
  BlockRecord,
  ContentMode,
  DataProvider,
  MediaRecord,
  PageRecord,
  RevisionRecord,
  UserRecord,
} from "./types";

import seedUsers from "@/data/seed/users.json";
import seedPages from "@/data/seed/pages.json";
import seedBlocks from "@/data/seed/blocks.json";

/**
 * LocalProvider — JSON-file backed store for development without Supabase.
 * State lives in .data/store.json (gitignored), seeded from data/seed/*.json.
 * Delete .data/ to reset to sample data. Uploads go to .data/uploads and are
 * served by app/api/media/[...path]/route.ts.
 *
 * Not safe for multi-instance/serverless production — dev & demos only.
 */

export type LocalUser = UserRecord & { passwordHash: string };

type Store = {
  version: 1;
  users: LocalUser[];
  pages: PageRecord[];
  blocks: BlockRecord[];
  revisions: RevisionRecord[];
  media: MediaRecord[];
};

export const LOCAL_DATA_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(LOCAL_DATA_DIR, "store.json");
export const LOCAL_UPLOAD_DIR = path.join(LOCAL_DATA_DIR, "uploads");

function now() {
  return new Date().toISOString();
}

function seedStore(): Store {
  const ts = now();
  return {
    version: 1,
    users: seedUsers as LocalUser[],
    pages: seedPages as PageRecord[],
    blocks: (seedBlocks as Array<{ scope: Scope; key: string; type: string; value: unknown }>).map((b) => {
      const content = blockContentSchema.parse({ type: b.type, value: b.value });
      return {
        id: randomUUID(),
        scope: b.scope,
        key: b.key,
        type: content.type,
        draft: null,
        published: content.value,
        updatedAt: ts,
        updatedBy: null,
      };
    }),
    revisions: [],
    media: [],
  };
}

// ── persistence with a single-writer queue (no torn writes within one process) ──

// Next may instantiate this module more than once per process (page vs route
// bundles), so the write queue lives on globalThis and we always read from disk.
const g = globalThis as typeof globalThis & { __sawadLocalQueue?: Promise<unknown> };
g.__sawadLocalQueue ??= Promise.resolve();

async function load(): Promise<Store> {
  try {
    return JSON.parse(await fs.readFile(STORE_FILE, "utf8")) as Store;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const store = seedStore();
    await persist(store);
    return store;
  }
}

async function persist(store: Store) {
  await fs.mkdir(LOCAL_DATA_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, STORE_FILE);
}

/** Serialize mutations so concurrent Server Actions can't interleave. */
function mutate<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const run = g.__sawadLocalQueue!.then(async () => {
    const store = await load();
    const result = await fn(store);
    await persist(store);
    return result;
  });
  g.__sawadLocalQueue = run.catch(() => undefined);
  return run;
}

async function read<T>(fn: (store: Store) => T): Promise<T> {
  await g.__sawadLocalQueue; // read-your-writes
  return fn(await load());
}

const clone = <T>(v: T): T => structuredClone(v);

function toContent(b: BlockRecord, mode: ContentMode): BlockContent | null {
  const value = mode === "draft" ? (b.draft ?? b.published) : b.published;
  if (value == null) return null;
  return { type: b.type, value } as BlockContent;
}

// ── internal helpers exposed for LocalAuth ──

export async function localFindUserByEmail(email: string): Promise<LocalUser | null> {
  return read((s) => clone(s.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null));
}

export async function localFindUserById(id: string): Promise<LocalUser | null> {
  return read((s) => clone(s.users.find((u) => u.id === id) ?? null));
}

// ── provider ──

export const localProvider: DataProvider = {
  // pages
  listPages: () => read((s) => clone([...s.pages].sort((a, b) => a.slug.localeCompare(b.slug)))),
  getPageBySlug: (slug) => read((s) => clone(s.pages.find((p) => p.slug === slug) ?? null)),
  getPageById: (id) => read((s) => clone(s.pages.find((p) => p.id === id) ?? null)),

  createPage: (input: PageInput) =>
    mutate((s) => {
      if (s.pages.some((p) => p.slug === input.slug)) {
        throw new Error(`A page with slug ${input.slug} already exists`);
      }
      const ts = now();
      const page: PageRecord = {
        id: randomUUID(),
        slug: input.slug,
        title: input.title,
        template: input.template,
        status: "draft",
        seo: input.seo ?? {},
        createdAt: ts,
        updatedAt: ts,
        publishedAt: null,
      };
      s.pages.push(page);
      return clone(page);
    }),

  updatePage: (id, input: Partial<PageInput> & { status?: PageStatus }) =>
    mutate((s) => {
      const page = s.pages.find((p) => p.id === id);
      if (!page) throw new Error("Page not found");
      if (input.slug && input.slug !== page.slug && s.pages.some((p) => p.slug === input.slug)) {
        throw new Error(`A page with slug ${input.slug} already exists`);
      }
      Object.assign(page, {
        ...(input.slug !== undefined && { slug: input.slug }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.template !== undefined && { template: input.template }),
        ...(input.seo !== undefined && { seo: input.seo }),
      });
      if (input.status && input.status !== page.status) {
        page.status = input.status;
        page.publishedAt = input.status === "published" ? now() : page.publishedAt;
      }
      page.updatedAt = now();
      return clone(page);
    }),

  deletePage: (id) =>
    mutate((s) => {
      const blockIds = new Set(s.blocks.filter((b) => b.scope === id).map((b) => b.id));
      s.pages = s.pages.filter((p) => p.id !== id);
      s.blocks = s.blocks.filter((b) => b.scope !== id);
      s.revisions = s.revisions.filter((r) => !blockIds.has(r.blockId));
    }),

  // content
  getContent: (scope, mode) =>
    read((s) => {
      const map: ContentMap = {};
      for (const b of s.blocks) {
        if (b.scope !== scope) continue;
        const c = toContent(b, mode);
        if (c) map[b.key] = clone(c);
      }
      return map;
    }),

  listBlocks: (scope) => read((s) => clone(s.blocks.filter((b) => b.scope === scope))),

  saveDrafts: (changes: BlockChange[], userId) =>
    mutate((s) => {
      const ts = now();
      for (const c of changes) {
        const existing = s.blocks.find((b) => b.scope === c.scope && b.key === c.key);
        if (existing) {
          if (existing.type !== c.type) {
            throw new Error(`Block ${c.key} is type ${existing.type}, got ${c.type}`);
          }
          existing.draft = clone(c.value);
          existing.updatedAt = ts;
          existing.updatedBy = userId;
        } else {
          s.blocks.push({
            id: randomUUID(),
            scope: c.scope,
            key: c.key,
            type: c.type,
            draft: clone(c.value),
            published: null,
            updatedAt: ts,
            updatedBy: userId,
          });
        }
      }
    }),

  publish: (scopes, userId) =>
    mutate((s) => {
      const ts = now();
      let count = 0;
      for (const b of s.blocks) {
        if (!scopes.includes(b.scope) || b.draft == null) continue;
        b.published = b.draft;
        b.draft = null;
        b.updatedAt = ts;
        b.updatedBy = userId;
        s.revisions.push({
          id: randomUUID(),
          blockId: b.id,
          content: clone({ type: b.type, value: b.published } as BlockContent),
          createdAt: ts,
          createdBy: userId,
        });
        count++;
      }
      return count;
    }),

  discardDrafts: (scopes) =>
    mutate((s) => {
      // Blocks that were never published are removed entirely.
      s.blocks = s.blocks.filter((b) => !(scopes.includes(b.scope) && b.published == null));
      for (const b of s.blocks) if (scopes.includes(b.scope)) b.draft = null;
    }),

  hasUnpublishedChanges: (scope) => read((s) => s.blocks.some((b) => b.scope === scope && b.draft != null)),

  listRevisions: (scope, key, limit = 20) =>
    read((s) => {
      const block = s.blocks.find((b) => b.scope === scope && b.key === key);
      if (!block) return [];
      return clone(
        s.revisions
          .filter((r) => r.blockId === block.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit),
      );
    }),

  restoreRevision: (revisionId, userId) =>
    mutate((s) => {
      const rev = s.revisions.find((r) => r.id === revisionId);
      if (!rev) throw new Error("Revision not found");
      const block = s.blocks.find((b) => b.id === rev.blockId);
      if (!block) throw new Error("Block not found");
      block.draft = clone(rev.content.value);
      block.updatedAt = now();
      block.updatedBy = userId;
    }),

  // media
  listMedia: () => read((s) => clone([...s.media].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))),

  uploadMedia: async (file, alt, userId) => {
    const id = randomUUID();
    const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "") || "";
    const storedName = `${id}${ext}`;
    await fs.mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_UPLOAD_DIR, storedName), file.bytes);
    return mutate((s) => {
      const record: MediaRecord = {
        id,
        url: `/api/media/${storedName}`,
        filename: file.name,
        contentType: file.type,
        size: file.bytes.byteLength,
        width: file.width,
        height: file.height,
        alt,
        createdAt: now(),
        createdBy: userId,
      };
      s.media.push(record);
      return clone(record);
    });
  },

  deleteMedia: (id) =>
    mutate(async (s) => {
      const rec = s.media.find((m) => m.id === id);
      if (!rec) return;
      s.media = s.media.filter((m) => m.id !== id);
      const name = path.basename(rec.url);
      await fs.rm(path.join(LOCAL_UPLOAD_DIR, name), { force: true });
    }),

  // users
  listUsers: () =>
    read((s) =>
      s.users.map((u): UserRecord => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt })).sort((a, b) => a.email.localeCompare(b.email)),
    ),

  setUserRole: (userId, role: Role) =>
    mutate((s) => {
      const user = s.users.find((u) => u.id === userId);
      if (!user) throw new Error("User not found");
      user.role = role;
    }),
};

export { GLOBAL_SCOPE };
