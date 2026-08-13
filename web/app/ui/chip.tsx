import type { HTMLAttributes } from "react";

type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "success" | "danger" | "active" | "brand";
};

export function Chip({ tone = "neutral", className = "", ...props }: ChipProps) {
  return <span className={`chip chip-${tone}${className ? ` ${className}` : ""}`} {...props} />;
}
