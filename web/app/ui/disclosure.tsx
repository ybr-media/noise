import { useId, type ReactNode } from "react";

type DisclosureProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
  triggerId?: string;
  contentId?: string;
};

export function Disclosure({ open, onOpenChange, summary, children, className = "", triggerClassName = "", triggerId, contentId: requestedContentId }: DisclosureProps) {
  const generatedId = useId();
  const contentId = requestedContentId ?? `disclosure-${generatedId.replace(/:/g, "")}`;
  return (
    <div className={`${className}${open ? " is-open" : ""}`}>
      <button id={triggerId} type="button" className={`disclosure-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`} aria-expanded={open} aria-controls={contentId} onClick={() => onOpenChange(!open)}>{summary}</button>
      {open && <div id={contentId}>{children}</div>}
    </div>
  );
}
