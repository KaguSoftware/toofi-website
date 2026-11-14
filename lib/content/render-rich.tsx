import { Fragment, type ReactNode } from "react";
import { hrefSchema, type RichNode, type RichTextValue } from "./schemas";

/**
 * Renders stored Tiptap JSON to React — whitelisted nodes/marks only, no
 * dangerouslySetInnerHTML, so stored content can never inject markup or scripts.
 * Works in Server and Client Components.
 */
export function RichTextView({ value, className }: { value: RichTextValue | null | undefined; className?: string }) {
  if (!value) return null;
  return <div className={className}>{renderChildren(value.doc.content)}</div>;
}

function renderChildren(nodes: RichNode[] | undefined): ReactNode {
  return nodes?.map((n, i) => renderNode(n, i));
}

function renderNode(node: RichNode, key: number): ReactNode {
  switch (node.type) {
    case "text":
      return renderMarks(node.text ?? "", node.marks, key);
    case "paragraph":
      return <p key={key}>{renderChildren(node.content)}</p>;
    case "heading": {
      const level = Number(node.attrs?.level);
      const Tag = (`h${level >= 2 && level <= 4 ? level : 2}`) as "h2" | "h3" | "h4";
      return <Tag key={key}>{renderChildren(node.content)}</Tag>;
    }
    case "bulletList":
      return <ul key={key}>{renderChildren(node.content)}</ul>;
    case "orderedList":
      return <ol key={key}>{renderChildren(node.content)}</ol>;
    case "listItem":
      return <li key={key}>{renderChildren(node.content)}</li>;
    case "blockquote":
      return <blockquote key={key}>{renderChildren(node.content)}</blockquote>;
    case "hardBreak":
      return <br key={key} />;
    case "horizontalRule":
      return <hr key={key} />;
    case "doc":
      return renderChildren(node.content);
    default:
      return null;
  }
}

function renderMarks(text: string, marks: RichNode["marks"], key: number): ReactNode {
  let out: ReactNode = text;
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case "bold":
        out = <strong>{out}</strong>;
        break;
      case "italic":
        out = <em>{out}</em>;
        break;
      case "strike":
        out = <s>{out}</s>;
        break;
      case "code":
        out = <code>{out}</code>;
        break;
      case "underline":
        out = <u>{out}</u>;
        break;
      case "link": {
        const href = hrefSchema.safeParse(mark.attrs.href);
        if (href.success && href.data) {
          const external = /^https?:\/\//i.test(href.data);
          out = (
            <a href={href.data} {...(external && { target: "_blank", rel: "noopener noreferrer" })}>
              {out}
            </a>
          );
        }
        break;
      }
    }
  }
  return <Fragment key={key}>{out}</Fragment>;
}

/** Plain-text excerpt (for meta descriptions, search, etc.). */
export function richTextToPlain(value: RichTextValue | null | undefined): string {
  const walk = (n: RichNode): string =>
    n.type === "text" ? (n.text ?? "") : (n.content ?? []).map(walk).join(n.type === "paragraph" ? " " : "");
  return value ? walk(value.doc).trim() : "";
}
