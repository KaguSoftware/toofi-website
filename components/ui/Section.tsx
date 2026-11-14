import type { ComponentPropsWithoutRef } from "react";

/** Vertical rhythm block. `tone="subtle"` alternates the background. */
export function Section({
  tone = "default",
  className,
  ...rest
}: ComponentPropsWithoutRef<"section"> & { tone?: "default" | "subtle" }) {
  return <section data-tone={tone} className={`section ${className ?? ""}`.trim()} {...rest} />;
}
