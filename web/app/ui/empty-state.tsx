import type { ReactNode } from "react";

type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, body, action, className = "" }: EmptyStateProps) {
  return <div className={`empty-state${className ? ` ${className}` : ""}`}>{icon && <div className="empty-state-icon">{icon}</div>}<strong>{title}</strong>{body && <div>{body}</div>}{action}</div>;
}
