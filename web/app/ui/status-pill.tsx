import type { HTMLAttributes } from "react";

type StatusPillProps = HTMLAttributes<HTMLSpanElement> & {
  state: string;
};

export function StatusPill({ state, className = "", ...props }: StatusPillProps) {
  const tone = state === "ready" || state === "submitted" || state === "named" ? "success" : state === "failed" || state === "cancelled" ? "danger" : state === "active" || state === "queued" || state === "rendering" ? "active" : "neutral";
  return <span className={`status-pill status-pill-${tone}${className ? ` ${className}` : ""}`} {...props} />;
}
