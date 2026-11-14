import type { ComponentPropsWithoutRef } from "react";

/** Horizontal page width + gutters. `size="narrow"` = reading width. */
export function Container({
  size = "default",
  className,
  ...rest
}: ComponentPropsWithoutRef<"div"> & { size?: "default" | "narrow" }) {
  return <div data-size={size} className={`container ${className ?? ""}`.trim()} {...rest} />;
}
