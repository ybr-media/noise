import type { HTMLAttributes } from "react";

type BannerProps = HTMLAttributes<HTMLDivElement> & {
  tone: "warning" | "danger";
};

export function Banner({ tone, className = "", ...props }: BannerProps) {
  return <div role={props.role ?? "alert"} className={`banner banner-${tone}${className ? ` ${className}` : ""}`} {...props} />;
}
