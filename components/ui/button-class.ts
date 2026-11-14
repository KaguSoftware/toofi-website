export type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse";
export type ButtonSize = "md" | "sm";

/**
 * Class string for anything that should look like a button — e.g. a CMS link:
 *   <c.Link k="hero.cta" className={buttonClass({ variant: "primary" })} fallback={…} />
 * (Styles live in app/globals.css under `.btn`.)
 */
export function buttonClass({ variant = "primary", size = "md" }: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return `btn btn-${variant}${size === "sm" ? " btn-sm" : ""}`;
}
