import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { getPublicData } from "@/lib/data";
import type { PageRecord } from "@/lib/data/types";
import { slugSchema, type ContentMap, type Scope } from "./schemas";
import { tags } from "./tags";

/**
 * Public, cached reads. Safe to call from any Server Component (no cookies).
 * Invalidated by Server Actions via updateTag(tags.*).
 *
 * Draft reads (edit mode) bypass these and go straight to getData() (session provider) after an
 * auth check — see lib/content/render-context.ts.
 */

export async function getPublishedPageBySlug(slug: string): Promise<PageRecord | null> {
  "use cache";
  cacheTag(tags.pages);
  if (!slugSchema.safeParse(slug).success) {
    cacheLife("minutes");
    return null;
  }
  const page = await getPublicData().getPageBySlug(slug);
  if (!page || page.status !== "published") {
    // Misses expire quickly so junk URLs don't pin cache entries forever.
    cacheLife("minutes");
    return null;
  }
  cacheLife("max");
  cacheTag(tags.page(page.id));
  return page;
}

export async function listPublishedPages(): Promise<PageRecord[]> {
  "use cache";
  cacheTag(tags.pages);
  cacheLife("max");
  const pages = await getPublicData().listPages();
  return pages.filter((p) => p.status === "published");
}

export async function getPublishedContent(scope: Scope): Promise<ContentMap> {
  "use cache";
  cacheTag(tags.content(scope));
  cacheLife("max");
  return getPublicData().getContent(scope, "published");
}
