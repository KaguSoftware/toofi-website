/**
 * Cache tags. Reads tag with these (lib/content/get.ts); Server Actions call
 * updateTag() with the same strings after writes. Keep all tag strings here.
 */
export const tags = {
  /** Any page list / page lookup by slug. */
  pages: "pages",
  /** A specific page record. */
  page: (pageId: string) => `page:${pageId}`,
  /** Published content of a scope ("global" or a page id). */
  content: (scope: string) => `content:${scope}`,
  media: "media",
} as const;
