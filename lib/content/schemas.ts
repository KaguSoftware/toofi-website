/**
 * Content block types + validation. Single source of truth used by:
 *  - Server Actions (validate every write)
 *  - Client editors (validate before sending)
 *  - Data providers (shape of stored jsonb)
 *
 * Safe to import from client components.
 */
import { z } from "zod";

// ───────────────────────── keys, slugs, scopes ─────────────────────────

/** Block key: dot-separated segments, e.g. "hero.title" or "team.k3j9x.name". */
export const blockKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/, "Invalid block key");

/** Page path: "/" or "/about" or "/services/web-design". Lowercase, kebab segments. */
export const slugSchema = z
  .string()
  .max(200)
  .regex(/^\/([a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*)?$/, "Use lowercase letters, numbers and dashes, e.g. /about-us");

/** "global" (header/footer etc.) or a page id. */
export const GLOBAL_SCOPE = "global" as const;
export const scopeSchema = z.union([z.literal(GLOBAL_SCOPE), z.string().uuid()]);
export type Scope = z.infer<typeof scopeSchema>;

// ───────────────────────── block values ─────────────────────────

export const textValueSchema = z.object({ text: z.string().max(5_000) });

/** No backslashes (browsers treat "/\evil.com" as protocol-relative) or control characters. */
const UNSAFE_URL_CHARS = /[\\\u0000-\u001f\u007f]/;

/** Safe-ish URL: relative path, #anchor, mailto:, tel:, or http(s). No javascript: etc. */
export const hrefSchema = z
  .string()
  .max(2_000)
  .refine((v) => !UNSAFE_URL_CHARS.test(v), "Link contains invalid characters")
  .refine(
    (v) => /^(\/(?!\/)|#|mailto:|tel:|https?:\/\/)/i.test(v) || v === "",
    "Link must start with /, #, mailto:, tel:, http:// or https://",
  );

export const linkValueSchema = z.object({
  text: z.string().max(500),
  href: hrefSchema,
  newTab: z.boolean().optional(),
});

export const imageValueSchema = z.object({
  src: z
    .string()
    .max(2_000)
    .refine((v) => !UNSAFE_URL_CHARS.test(v), "Image src contains invalid characters")
    .refine((v) => /^(\/(?!\/)|https:\/\/)/.test(v), "Image src must be a relative path or https URL"),
  alt: z.string().max(500),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
});

/** Ordered list of item ids; each item's fields are their own blocks: `${listKey}.${id}.${field}`. */
export const listItemIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/);
export const listValueSchema = z.object({ items: z.array(listItemIdSchema).max(200) });

// Rich text = Tiptap/ProseMirror JSON, restricted to a whitelist of nodes & marks.
export const RICH_NODE_TYPES = [
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "hardBreak",
  "horizontalRule",
] as const;
export const RICH_MARK_TYPES = ["bold", "italic", "strike", "code", "underline", "link"] as const;

const richMarkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }),
  z.object({ type: z.literal("italic") }),
  z.object({ type: z.literal("strike") }),
  z.object({ type: z.literal("code") }),
  z.object({ type: z.literal("underline") }),
  z.object({
    type: z.literal("link"),
    // Unknown attrs are stripped, not passed through.
    attrs: z.object({
      href: hrefSchema,
      target: z.enum(["_blank", "_self"]).nullish(),
      rel: z.string().max(100).nullish(),
      class: z.string().max(100).nullish(),
    }),
  }),
]);

/** Node attributes we keep (heading level, ordered-list start/type). Everything else is stripped. */
const richNodeAttrsSchema = z.object({
  level: z.number().int().min(1).max(6).optional(),
  start: z.number().int().min(0).max(100_000).optional(),
  type: z.string().max(20).nullish(),
});

export type RichNode = {
  type: (typeof RICH_NODE_TYPES)[number];
  attrs?: z.infer<typeof richNodeAttrsSchema>;
  content?: RichNode[];
  marks?: z.infer<typeof richMarkSchema>[];
  text?: string;
};

export const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.enum(RICH_NODE_TYPES),
    attrs: richNodeAttrsSchema.optional(),
    content: z.array(richNodeSchema).max(2_000).optional(),
    marks: z.array(richMarkSchema).max(10).optional(),
    text: z.string().max(20_000).optional(),
  }),
);

export const RICH_MAX_DEPTH = 24;

/** Iterative depth check, run BEFORE the recursive schema so deep input can't overflow the stack. */
function withinDepth(value: unknown, max = RICH_MAX_DEPTH): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (depth > max) return false;
    const content = (node as { content?: unknown } | null)?.content;
    if (Array.isArray(content)) for (const child of content) stack.push([child, depth + 1]);
  }
  return true;
}

export const richTextValueSchema = z.object({
  doc: z
    .unknown()
    .refine((v) => withinDepth(v), { message: "Rich text is nested too deeply", abort: true })
    .pipe(richNodeSchema.refine((n) => n.type === "doc", "Root node must be 'doc'")),
});

// ───────────────────────── union ─────────────────────────

export const BLOCK_TYPES = ["text", "richtext", "image", "link", "list"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const blockValueSchemas = {
  text: textValueSchema,
  richtext: richTextValueSchema,
  image: imageValueSchema,
  link: linkValueSchema,
  list: listValueSchema,
} as const satisfies Record<BlockType, z.ZodType>;

export type BlockValueMap = {
  [K in BlockType]: z.infer<(typeof blockValueSchemas)[K]>;
};
export type TextValue = BlockValueMap["text"];
export type RichTextValue = BlockValueMap["richtext"];
export type ImageValue = BlockValueMap["image"];
export type LinkValue = BlockValueMap["link"];
export type ListValue = BlockValueMap["list"];

/** A typed block value as stored and rendered. */
export type BlockContent = {
  [K in BlockType]: { type: K; value: BlockValueMap[K] };
}[BlockType];

export const blockContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), value: textValueSchema }),
  z.object({ type: z.literal("richtext"), value: richTextValueSchema }),
  z.object({ type: z.literal("image"), value: imageValueSchema }),
  z.object({ type: z.literal("link"), value: linkValueSchema }),
  z.object({ type: z.literal("list"), value: listValueSchema }),
]);

/** One pending change sent from the editor to saveDrafts(). */
export const blockChangeSchema = z
  .object({ scope: scopeSchema, key: blockKeySchema })
  .and(blockContentSchema);
export type BlockChange = z.infer<typeof blockChangeSchema>;

/** Map of key → content for one scope. */
export type ContentMap = Record<string, BlockContent>;

// ───────────────────────── pages ─────────────────────────

export const PAGE_STATUSES = ["draft", "published"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

export const pageSeoSchema = z.object({
  description: z.string().max(300).optional(),
  ogImage: z.string().max(2_000).optional(),
  noindex: z.boolean().optional(),
});

export const pageInputSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1).max(200),
  template: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  seo: pageSeoSchema.default({}),
});
export type PageInput = z.infer<typeof pageInputSchema>;
