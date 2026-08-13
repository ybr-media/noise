import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = (ButtonHTMLAttributes<HTMLButtonElement> & { as?: "button" }) | (AnchorHTMLAttributes<HTMLAnchorElement> & { as: "a" });
type ButtonOptions = {
  variant?: "primary" | "secondary" | "neutral" | "link";
  icon?: ReactNode;
};

export function Button({ variant = "primary", icon, children, className = "", as = "button", ...props }: ButtonProps & ButtonOptions) {
  const classes = `ui-button ui-button-${variant}${className ? ` ${className}` : ""}`;
  if (as === "a") {
    return <a className={classes} {...props as AnchorHTMLAttributes<HTMLAnchorElement>}>{icon}{children}</a>;
  }
  return <button className={classes} {...props as ButtonHTMLAttributes<HTMLButtonElement>}>{icon}{children}</button>;
}
