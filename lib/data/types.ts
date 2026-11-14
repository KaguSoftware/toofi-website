/**
 * DataProvider — the only way app code touches persistent data.
 * Two implementations: LocalProvider (sample data, dev) and SupabaseProvider.
 *
 * IMPORTANT: providers do NOT perform authorization. Callers (Server Actions,
 * route handlers, server components) must call the guards in lib/auth/guards.ts
 * first. In Supabase mode RLS is a second line of defence.
 */
import type { Role, SessionUser } from "@/lib/auth/roles";
import type {
  BlockChange,
  BlockContent,
  ContentMap,
  PageInput,
  PageStatus,
  Scope,
} from "@/lib/content/schemas";
import type { z } from "zod";
import type { pageSeoSchema } from "@/lib/content/schemas";

export type PageRecord = {
  id: string;
  slug: string;
  title: string;
  template: string;
  status: PageStatus;
  seo: z.infer<typeof pageSeoSchema>;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type BlockRecord = {
  id: string;
  scope: Scope;
  key: string;
  type: BlockContent["type"];
  draft: BlockContent["value"] | null;
  published: BlockContent["value"] | null;
  updatedAt: string;
  updatedBy: string | null;
};

export type RevisionRecord = {
  id: string;
  blockId: string;
  content: BlockContent;
  createdAt: string;
  createdBy: string | null;
};

export type MediaRecord = {
  id: string;
  /** Public URL usable in <img src> / next/image. */
  url: string;
  filename: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  alt: string;
  createdAt: string;
  createdBy: string | null;
};

export type UserRecord = SessionUser & { createdAt: string };

export type ContentMode = "published" | "draft";

export interface DataProvider {
  // pages
  listPages(): Promise<PageRecord[]>;
  getPageBySlug(slug: string): Promise<PageRecord | null>;
  getPageById(id: string): Promise<PageRecord | null>;
  createPage(input: PageInput, userId: string): Promise<PageRecord>;
  updatePage(id: string, input: Partial<PageInput> & { status?: PageStatus }, userId: string): Promise<PageRecord>;
  deletePage(id: string): Promise<void>;

  // content
  /** "published": published values only. "draft": draft ?? published. */
  getContent(scope: Scope, mode: ContentMode): Promise<ContentMap>;
  listBlocks(scope: Scope): Promise<BlockRecord[]>;
  /** Upsert drafts. Values must already be validated. */
  saveDrafts(changes: BlockChange[], userId: string): Promise<void>;
  /** Copy draft → published for every block with a draft in these scopes; records revisions. Returns count. */
  publish(scopes: Scope[], userId: string): Promise<number>;
  /** Drop all drafts in these scopes. */
  discardDrafts(scopes: Scope[]): Promise<void>;
  hasUnpublishedChanges(scope: Scope): Promise<boolean>;
  listRevisions(scope: Scope, key: string, limit?: number): Promise<RevisionRecord[]>;
  /** Restore a revision into the block's draft. */
  restoreRevision(revisionId: string, userId: string): Promise<void>;

  // media
  listMedia(): Promise<MediaRecord[]>;
  uploadMedia(
    file: { name: string; type: string; bytes: Uint8Array; width?: number; height?: number },
    alt: string,
    userId: string,
  ): Promise<MediaRecord>;
  deleteMedia(id: string): Promise<void>;

  // users (admin)
  listUsers(): Promise<UserRecord[]>;
  setUserRole(userId: string, role: Role): Promise<void>;
}
