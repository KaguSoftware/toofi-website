import "server-only";
import { Fragment, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  blockValueSchemas,
  type ContentMap,
  type ImageValue,
  type LinkValue,
  type RichTextValue,
  type Scope,
} from "./schemas";
import { RichTextView } from "./render-rich";
import {
  EditableImageClient,
  EditableLinkClient,
  EditableListClient,
  EditableRichTextClient,
  EditableTextClient,
} from "@/components/editable/client";
import type { TextTag } from "@/components/editable/types";

/**
 * createEditables() — the API templates use to declare editable content.
 *
 *   export default function Home({ c }: TemplateProps) {
 *     return (
 *       <section>
 *         <c.Text k="hero.title" as="h1" fallback="Welcome" className="..." />
 *         <c.RichText k="hero.body" fallback="Intro paragraph" />
 *         <c.Image k="hero.image" fallback={{ src: "/placeholder.svg", alt: "" }} />
 *         <c.Link k="hero.cta" fallback={{ text: "Get started", href: "/contact" }} />
 *         <c.List k="features" fallbackItems={["a", "b", "c"]} render={(item) => (
 *           <item.Text k="title" as="h3" fallback="Feature" />
 *         )} />
 *       </section>
 *     );
 *   }
 *
 * View mode → plain server HTML, zero editor JS.
 * Edit mode → the same markup wrapped in client islands from components/editable.
 * `fallback` is shown until an editor saves a value (so new pages render immediately).
 */

export type RenderContext = {
  scope: Scope;
  content: ContentMap;
  editing: boolean;
  /** Key prefix for list items ("team.k3j9x"). Internal. */
  prefix?: string;
};

type TextProps = {
  k: string;
  as?: TextTag;
  fallback?: string;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
};
type RichTextProps = { k: string; fallback?: string | RichTextValue; className?: string; placeholder?: string };
type ImageProps = {
  k: string;
  fallback: ImageValue;
  className?: string;
  sizes?: string;
  priority?: boolean;
};
type LinkProps = { k: string; fallback: LinkValue; className?: string; children?: never };
type ListProps = {
  k: string;
  /** Item ids rendered before anything is saved, e.g. ["a","b","c"] → 3 placeholder items. */
  fallbackItems?: string[];
  render: (item: Editables, index: number) => ReactNode;
  as?: "div" | "ul" | "ol" | "section";
  itemAs?: "div" | "li" | "article";
  className?: string;
  itemClassName?: string;
  addLabel?: string;
  max?: number;
};

export type Editables = {
  Text: (p: TextProps) => ReactNode;
  RichText: (p: RichTextProps) => ReactNode;
  Image: (p: ImageProps) => ReactNode;
  Link: (p: LinkProps) => ReactNode;
  List: (p: ListProps) => ReactNode;
  /** Raw access for non-visual use (e.g. a text value inside an aria-label). */
  text: (k: string, fallback?: string) => string;
  editing: boolean;
};

export function textToRich(text: string): RichTextValue {
  return {
    doc: {
      type: "doc",
      content: text.split(/\n{2,}/).map((para) => ({
        type: "paragraph",
        content: para ? [{ type: "text", text: para }] : undefined,
      })),
    },
  };
}

export function createEditables(ctx: RenderContext): Editables {
  const fullKey = (k: string) => (ctx.prefix ? `${ctx.prefix}.${k}` : k);
  // Stored values are re-validated on read: a malformed row (bad migration, direct DB
  // write) falls back to the template default instead of crashing the public page.
  const get = <T extends ContentMap[string]["type"]>(k: string, type: T) => {
    const block = ctx.content[fullKey(k)];
    if (block?.type !== type) return undefined;
    const parsed = blockValueSchemas[type].safeParse(block.value);
    return parsed.success ? (parsed.data as Extract<ContentMap[string], { type: T }>["value"]) : undefined;
  };

  const text = (k: string, fallback = "") => get(k, "text")?.text ?? fallback;

  function Text({ k, as = "span", fallback = "", className, placeholder, multiline }: TextProps) {
    const value = text(k, fallback);
    if (ctx.editing) {
      return (
        <EditableTextClient
          scope={ctx.scope}
          blockKey={fullKey(k)}
          initial={value}
          as={as}
          className={className}
          placeholder={placeholder ?? fallback}
          multiline={multiline}
        />
      );
    }
    const Tag = as;
    return (
      <Tag className={className} style={multiline ? { whiteSpace: "pre-line" } : undefined}>
        {value}
      </Tag>
    );
  }

  function RichText({ k, fallback, className, placeholder }: RichTextProps) {
    const stored = get(k, "richtext");
    const value = stored ?? (typeof fallback === "string" ? textToRich(fallback) : (fallback ?? null));
    if (ctx.editing) {
      return (
        <EditableRichTextClient
          scope={ctx.scope}
          blockKey={fullKey(k)}
          initial={value}
          className={className}
          placeholder={placeholder}
        />
      );
    }
    return <RichTextView value={value} className={className} />;
  }

  function EditableImage({ k, fallback, className, sizes, priority }: ImageProps) {
    const value = get(k, "image") ?? fallback;
    if (ctx.editing) {
      return (
        <EditableImageClient
          scope={ctx.scope}
          blockKey={fullKey(k)}
          initial={value}
          className={className}
          sizes={sizes}
          priority={priority}
        />
      );
    }
    return (
      <Image
        src={value.src}
        alt={value.alt}
        width={value.width ?? 1600}
        height={value.height ?? 900}
        sizes={sizes ?? "100vw"}
        priority={priority}
        className={className}
      />
    );
  }

  function EditableLink({ k, fallback, className }: LinkProps) {
    const value = get(k, "link") ?? fallback;
    if (ctx.editing) {
      return <EditableLinkClient scope={ctx.scope} blockKey={fullKey(k)} initial={value} className={className} />;
    }
    const external = /^https?:\/\//i.test(value.href);
    if (!external && value.href.startsWith("/")) {
      return (
        <Link href={value.href} className={className} {...(value.newTab && { target: "_blank" })}>
          {value.text}
        </Link>
      );
    }
    return (
      <a
        href={value.href}
        className={className}
        {...((value.newTab || external) && { target: "_blank", rel: "noopener noreferrer" })}
      >
        {value.text}
      </a>
    );
  }

  function List({
    k,
    fallbackItems = [],
    render,
    as = "div",
    itemAs = "div",
    className,
    itemClassName,
    addLabel,
    max,
  }: ListProps) {
    const ids = get(k, "list")?.items ?? fallbackItems;
    const items = ids.map((id, i) => (
      <Fragment key={id}>{render(createEditables({ ...ctx, prefix: `${fullKey(k)}.${id}` }), i)}</Fragment>
    ));
    if (ctx.editing) {
      return (
        <EditableListClient
          scope={ctx.scope}
          blockKey={fullKey(k)}
          itemIds={ids}
          items={items}
          as={as}
          itemAs={itemAs}
          className={className}
          itemClassName={itemClassName}
          addLabel={addLabel}
          max={max}
        />
      );
    }
    const Tag = as;
    const ItemTag = itemAs;
    return (
      <Tag className={className}>
        {items.map((node, i) => (
          <ItemTag key={ids[i]} className={itemClassName}>
            {node}
          </ItemTag>
        ))}
      </Tag>
    );
  }

  return { Text, RichText, Image: EditableImage, Link: EditableLink, List, text, editing: ctx.editing };
}
