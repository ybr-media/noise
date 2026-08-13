import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "article" | "div" | "section";
  padding?: "sm" | "md";
};

export function Card({ as = "div", padding = "md", className = "", ...props }: CardProps) {
  const Component = as;
  return <Component className={`soft-card card-padding-${padding}${className ? ` ${className}` : ""}`} {...props} />;
}
