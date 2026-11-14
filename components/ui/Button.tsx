import type { ButtonHTMLAttributes } from "react";
import type { ButtonSize, ButtonVariant } from "./button-class";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize };

/** A real <button>. For links use <Link className={buttonClass()}> or <c.Link className=…>. */
export function Button({ variant = "primary", size = "md", type = "button", className, ...rest }: Props) {
  return <button type={type} data-variant={variant} data-size={size} className={`btn ${className ?? ""}`.trim()} {...rest} />;
}
