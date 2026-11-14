import type { ComponentPropsWithoutRef, ElementType } from "react";

/**
 * Text styles as classes (see "Type scale" in globals.css) — usable on plain
 * elements AND on editables, which take a className:
 *   <c.Text k="title" as="h1" className={type.display} />
 */
export const type = {
  display: "t-display",
  title: "t-title",
  headline: "t-headline",
  lead: "t-lead",
  body: "t-body",
  small: "t-small",
  eyebrow: "t-eyebrow",
} as const;

export function Eyebrow({ className, ...rest }: ComponentPropsWithoutRef<"p">) {
  return <p className={`t-eyebrow ${className ?? ""}`.trim()} {...rest} />;
}

export function Heading<T extends ElementType = "h2">({
  as,
  level = "title",
  className,
  ...rest
}: { as?: T; level?: "display" | "title" | "headline" } & Omit<ComponentPropsWithoutRef<T>, "as" | "level">) {
  const Tag: ElementType = as ?? "h2";
  return <Tag className={`${type[level]} ${className ?? ""}`.trim()} {...rest} />;
}
