import { BELL_MARK_BODY } from "@/lib/bell-mark";

export function BellMark() {
  return (
    <svg
      className="bell-mark"
      viewBox="-1 0 102 100"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: BELL_MARK_BODY }}
    />
  );
}
