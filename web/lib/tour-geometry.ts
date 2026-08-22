/**
 * Geometry for the first-run tour's spotlight and tooltip. Kept DOM-free so the
 * rules — rounded cutouts derived from the target, and a tooltip that never
 * covers the thing it is pointing at — are testable without a browser.
 */
export type Box = { top: number; left: number; width: number; height: number };

/** Breathing room between the target's own edge and the cutout. */
export const SPOTLIGHT_PADDING = 8;
/** How far the ring sits outside the cutout. */
export const RING_OFFSET = 2;
export const RING_WIDTH = 2;
/** Minimum clear gap between the tooltip and the ring. */
export const TOOLTIP_CLEARANCE = 16;
export const VIEWPORT_MARGIN = 14;

export function inflate(box: Box, amount: number): Box {
  return {
    top: box.top - amount,
    left: box.left - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}

/** The lit hole around the target: its bounds plus even padding. */
export function spotlightBox(target: Box): Box {
  return inflate(target, SPOTLIGHT_PADDING);
}

/** The ring hugs the cutout, so it needs the cutout's box grown by its offset. */
export function ringBox(target: Box): Box {
  return inflate(spotlightBox(target), RING_OFFSET);
}

/**
 * A cutout corner stays parallel to the target's own corner: the target's
 * radius plus the padding we added. A pill target (radius at or beyond half its
 * height) keeps a pill cutout at any size.
 */
export function cutoutRadius(target: Box, targetRadius: number, growth = SPOTLIGHT_PADDING): number {
  const box = inflate(target, growth);
  const pill = targetRadius >= Math.min(target.width, target.height) / 2 - 0.5;
  const radius = pill ? box.height / 2 : targetRadius + growth;
  return Math.max(growth, Math.min(radius, Math.min(box.width, box.height) / 2));
}

function roundedRectPath(box: Box, radius: number): string {
  const r = Math.max(0, Math.min(radius, Math.min(box.width, box.height) / 2));
  const { top, left } = box;
  const right = left + box.width;
  const bottom = top + box.height;
  return `M${left + r},${top}H${right - r}A${r},${r} 0 0 1 ${right},${top + r}V${bottom - r}A${r},${r} 0 0 1 ${right - r},${bottom}H${left + r}A${r},${r} 0 0 1 ${left},${bottom - r}V${top + r}A${r},${r} 0 0 1 ${left + r},${top}Z`;
}

/**
 * The dimming layer as a single path with a rounded hole, so the scrim's edge
 * follows the target's shape instead of four square-cornered blockers.
 */
export function scrimPath(viewport: { width: number; height: number }, cutout: Box, radius: number): string {
  const outer = `M0,0H${viewport.width}V${viewport.height}H0Z`;
  return `${outer}${roundedRectPath(cutout, radius)}`;
}

export function ringPath(target: Box, targetRadius: number): string {
  const box = ringBox(target);
  return roundedRectPath(box, cutoutRadius(target, targetRadius, SPOTLIGHT_PADDING + RING_OFFSET));
}

export type TooltipPlacement = {
  placement: "top" | "bottom";
  top: number;
  /** False when no placement clears the ring, so the ring is dropped instead of hidden behind the card. */
  ringVisible: boolean;
};

/**
 * Place the card on the side of the spotlight with room for it, keeping a full
 * clearance gap. The card sits opposite the spotlight's vertical centre, so a
 * target high on the screen gets a card below it and vice versa.
 */
export function tooltipPlacement(target: Box, cardHeight: number, viewportHeight: number): TooltipPlacement {
  const ring = ringBox(target);
  const ringBottom = ring.top + ring.height;
  const belowTop = ringBottom + TOOLTIP_CLEARANCE;
  const aboveTop = ring.top - TOOLTIP_CLEARANCE - cardHeight;
  const fitsBelow = belowTop + cardHeight <= viewportHeight - VIEWPORT_MARGIN;
  const fitsAbove = aboveTop >= VIEWPORT_MARGIN;
  const prefersBelow = ring.top + ring.height / 2 <= viewportHeight / 2;
  const clamp = (top: number) => Math.max(VIEWPORT_MARGIN, Math.min(viewportHeight - cardHeight - VIEWPORT_MARGIN, top));
  if (fitsBelow && (prefersBelow || !fitsAbove)) return { placement: "bottom", top: belowTop, ringVisible: true };
  if (fitsAbove) return { placement: "top", top: aboveTop, ringVisible: true };
  if (fitsBelow) return { placement: "bottom", top: belowTop, ringVisible: true };
  const spaceBelow = viewportHeight - ringBottom;
  const placement = spaceBelow >= ring.top ? "bottom" : "top";
  return { placement, top: clamp(placement === "bottom" ? belowTop : aboveTop), ringVisible: false };
}
