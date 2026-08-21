import { BELL_MARK_BODY } from "@/lib/bell-mark";

const bellMarkBody = BELL_MARK_BODY
  .replace('<path fill="#ffdc4a"', '<path class="bell-body" fill="#ffdc4a"')
  .replace('<path fill="#c1a633"', '<path class="bell-shadow" fill="#c1a633"')
  .replace('<path fill="#fcecac"', '<path class="bell-face" fill="#fcecac"')
  .replace('<path fill="#231f20"', '<path class="bell-ink" fill="#231f20"')
  .replace('<path fill="#231f20"', '<path class="bell-eyes" fill="#231f20"')
  .replace('<path fill="none" stroke="#231f20"', '<path class="bell-smile" fill="none" stroke="#231f20"');

export function BellMark() {
  return (
    <svg
      className="bell-mark"
      viewBox="-1 0 102 100"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: bellMarkBody }}
    />
  );
}
