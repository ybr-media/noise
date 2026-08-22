"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { RING_WIDTH, cutoutRadius, ringPath, scrimPath, spotlightBox, tooltipPlacement, type Box } from "../../lib/tour-geometry";

export type TourMode = "local" | "dispatch" | "unavailable";
export type TourEventType = "param-selected" | "fx-changed" | "render-enqueued" | "tab-changed" | "track-played";
export type TourEvent = { type: TourEventType; group?: string };
export type TourEventMeta = { jobId?: string; variantId?: string };
export type TourSnapshot = {
  params?: string;
  renderLabel?: string;
  queuedVariantId?: string | null;
  playedTrackId?: string | null;
  renderStatus?: string;
};
export type TourEventSpec = TourEvent & { target?: string };
export type TourStep = {
  id: string;
  kind: "info" | "action";
  tab?: "create" | "library";
  target?: string;
  /** Used when the preferred target is absent, so a step never points at nothing. */
  fallbackTarget?: string;
  event?: TourEventType;
  group?: string;
  eventSequence?: readonly TourEventSpec[];
  title: string;
  body: string;
  /** What to do on this step, naming an action the spotlighted element can perform. */
  instruction?: string;
  /** Label for the optional automation, spelling out exactly what it will do. */
  autoAction?: string;
  /** Copy for when the fallback target is spotlighted, where the instruction no longer applies. */
  fallbackCopy?: { body?: string; instruction?: string };
};

export function tutorialSteps(mode: TourMode): TourStep[] {
  const renderStep: TourStep = mode === "unavailable"
    ? {
      id: "render-unavailable",
      kind: "info",
      tab: "create",
      target: "create-render",
      title: "Browse, not render",
      body: "This console is browse-only — designs render elsewhere and land in the Library.",
    }
    : {
      id: "render",
      kind: "action",
      tab: "create",
      target: "create-render",
      event: "render-enqueued",
      title: "Create the track",
      body: "Tap Create track to render a full-length master plus stems. It lands in your Library when it's done.",
      instruction: "Tap Create track",
      autoAction: "Create the track for me",
    };
  const progressStep: TourStep = mode === "unavailable"
    ? {
      id: "progress-unavailable",
      kind: "info",
      target: "render-status",
      title: "Where renders show up",
      body: "When designs render elsewhere, this line tracks them, and finished masters land in the Library.",
    }
    : {
      id: "progress",
      kind: "info",
      target: "render-status",
      title: "Follow your render",
      body: "This line tracks your render on every tab — Queued, Running, Ready. Tap it for the full detail. You don't have to wait here; we'll tell you when it lands.",
    };
  return [
    {
      id: "welcome",
      kind: "info",
      title: "Make your first track",
      body: "You'll design a sound, render it for real, and hear the result. Two minutes, and you keep whatever you make.",
    },
    {
      id: "param-color",
      kind: "action",
      tab: "create",
      target: "create-color",
      event: "param-selected",
      group: "color",
      title: "Pick a color",
      body: "Color sets the tilt of the noise: White is flat, Brown is deepest. The caption on the right names exactly what you picked.",
      instruction: "Tap a color to try it",
      autoAction: "Pick Green for me",
    },
    {
      id: "param-shape",
      kind: "action",
      tab: "create",
      target: "create-shape",
      event: "param-selected",
      group: "shape",
      title: "Now narrow it down",
      body: "Band, Motion and Balance decide which part of the spectrum you keep, how much it moves, and how it's mixed. Change any one — the caption and the spectrum follow.",
      instruction: "Tap a control to try it",
      autoAction: "Set Band to Broad for me",
    },
    {
      id: "fx",
      kind: "action",
      tab: "create",
      target: "create-fx",
      event: "fx-changed",
      title: "Optional: EQ and reverb",
      body: "EQ presets — Warm Bed, Airy, Midnight, Telephone — are starting points you can nudge band by band, whether EQ is already on or you switch it on. Reverb adds a room. Both bake into the render, not just the preview.",
      instruction: "Change an EQ or reverb control",
      autoAction: "Turn on the Warm Bed EQ for me",
    },
    renderStep,
    progressStep,
    {
      id: "library-open",
      kind: "action",
      tab: "library",
      target: "dock-library",
      event: "tab-changed",
      group: "library",
      title: "Your masters live here",
      body: "Everything you render lands in Library, with its own QA numbers and downloads.",
      instruction: "Tap Library — finished masters live there",
      autoAction: "Open Library for me",
    },
    {
      id: "library-play",
      kind: "action",
      tab: "library",
      target: "library-track",
      fallbackTarget: "library-header",
      event: "track-played",
      title: "Hear a master",
      body: "Each master downloads as the finished file, a single stem, or all of it as a zip.",
      instruction: "Press play",
      autoAction: "Play it for me",
      fallbackCopy: { body: "Your first master shows up here when it finishes, ready to play and download." },
    },
    {
      id: "done",
      kind: "info",
      title: "That's the loop",
      body: "Rename a track with the sparkle button, and keep your approved masters together in your Library when you're ready. Replay this any time from the (i) button.",
    },
  ];
}

export function tourEventMatches(step: TourStep, event: TourEvent, eventIndex = 0): boolean {
  const expected = step.eventSequence?.[eventIndex] ?? (step.event ? { type: step.event, group: step.group } : undefined);
  return step.kind === "action"
    && expected?.type === event.type
    && (!expected.group || expected.group === event.group);
}

export function shouldPersistTutorial(authConfigured: boolean, replay: boolean): boolean {
  return authConfigured && !replay;
}

export function playedTrackIdAfterPlayback(
  current: string | null,
  variantId: string,
  outcome: "playing" | "error",
): string | null {
  if (outcome === "playing") return variantId;
  return current === variantId ? null : current;
}

export function finaleCopy(snapshot: TourSnapshot): string {
  const playback = snapshot.playedTrackId
    ? snapshot.queuedVariantId && snapshot.playedTrackId === snapshot.queuedVariantId
      ? "played the master you just queued"
      : "played a master from your Library"
    : "haven't played a master yet";
  return `You designed ${snapshot.params ?? "your sound"}, queued ${snapshot.renderLabel ?? "your track"}, and ${playback}. Rename a track with the sparkle button, and keep your approved masters together in your Library when you're ready. Replay this any time from the (i) button.`;
}

/**
 * The tour only ever points at a master that passed QA, so a failing card is never the example.
 * With nothing eligible, the caller spotlights the Library header instead.
 */
export function tourLibraryTrackId(
  tracks: readonly { variantId: string; exists: boolean; qaVerdict: "PASS" | "FAIL" | "UNAVAILABLE" }[],
  preferred?: string,
): string | undefined {
  const eligible = tracks.filter((track) => track.exists && track.qaVerdict === "PASS");
  return eligible.find((track) => track.variantId === preferred)?.variantId ?? eligible[0]?.variantId;
}

/** The finale offers a way to act on an unfinished render instead of just mentioning it. */
export function shouldOfferRenderStatus(snapshot: TourSnapshot): boolean {
  return snapshot.renderStatus === "Queued" || snapshot.renderStatus === "Rendering";
}

export function shouldFireRenderBanner(alreadyShown: boolean, status: string | undefined): boolean {
  return !alreadyShown && status === "Done";
}

type TutorialProps = {
  mode: TourMode;
  authConfigured: boolean;
  onDoItForMe?: (step: TourStep) => void;
  onCheckRenderStatus?: () => void;
  onComplete?: () => void;
  snapshot?: TourSnapshot;
};

export function useTutorial({ mode, authConfigured, onDoItForMe, onCheckRenderStatus, onComplete, snapshot = {} }: TutorialProps) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [eventIndex, setEventIndex] = useState(0);
  const [celebration, setCelebration] = useState<string | null>(null);
  const onDoItForMeRef = useRef(onDoItForMe);
  const activeRef = useRef(active);
  const stepsRef = useRef<TourStep[]>([]);
  const stepIndexRef = useRef(stepIndex);
  const eventIndexRef = useRef(eventIndex);
  const replayRef = useRef(false);
  const celebrationTimerRef = useRef<number | null>(null);
  onDoItForMeRef.current = onDoItForMe;
  const steps = useMemo(() => tutorialSteps(mode), [mode]);
  activeRef.current = active;
  stepsRef.current = steps;
  stepIndexRef.current = stepIndex;
  eventIndexRef.current = eventIndex;
  const step = steps[stepIndex] ?? steps[0];
  const target = step.eventSequence?.[eventIndex]?.target ?? step.target;

  const complete = useCallback(() => {
    setActive(false);
    onComplete?.();
    if (shouldPersistTutorial(authConfigured, replayRef.current)) void fetch("/api/me/tutorial", { method: "POST" });
  }, [authConfigured, onComplete]);
  const start = useCallback((options?: { replay?: boolean }) => {
    replayRef.current = options?.replay ?? false;
    setStepIndex(0);
    setEventIndex(0);
    setCelebration(null);
    setActive(true);
  }, []);
  const notify = useCallback((type: TourEventType, group?: string, meta?: TourEventMeta) => {
    if (!activeRef.current) return;
    void meta;
    const currentSteps = stepsRef.current;
    const currentIndex = stepIndexRef.current;
    const currentEventIndex = eventIndexRef.current;
    const currentStep = currentSteps[currentIndex];
    if (!tourEventMatches(currentStep, { type, group }, currentEventIndex)) return;
    if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
    const message = type === "render-enqueued" ? "Queued. It's on its way." : "Nice — that's exactly it.";
    setCelebration(message);
    try { navigator.vibrate?.(10); } catch { /* vibration is optional */ }
    celebrationTimerRef.current = window.setTimeout(() => {
      if (stepIndexRef.current !== currentIndex || eventIndexRef.current !== currentEventIndex) return;
      setCelebration(null);
      const sequenceLength = currentStep.eventSequence?.length ?? 1;
      if (currentEventIndex < sequenceLength - 1) {
        setEventIndex(currentEventIndex + 1);
      } else {
        setEventIndex(0);
        setStepIndex((current) => current === currentIndex ? Math.min(currentIndex + 1, currentSteps.length - 1) : current);
      }
    }, 420);
  }, []);
  useEffect(() => () => {
    if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
  }, []);
  const skip = useCallback(() => {
    if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
    setCelebration(null);
    complete();
  }, [complete]);
  const doItForMe = useCallback(() => {
    if (step.kind === "action") onDoItForMeRef.current?.(step);
  }, [step]);

  return {
    active,
    step,
    stepIndex,
    steps,
    start,
    notify,
    complete,
    skip,
    doItForMe,
    overlay: active ? <TutorialOverlay step={step} target={target} stepIndex={stepIndex} total={steps.length} snapshot={snapshot} celebration={celebration} onNext={() => {
      setEventIndex(0);
      if (stepIndex === steps.length - 1) complete();
      else setStepIndex((current) => current + 1);
    }} onBack={() => {
      setEventIndex(0);
      setStepIndex((current) => Math.max(0, current - 1));
    }} onSkip={skip} onDoItForMe={doItForMe} onCheckRenderStatus={() => {
      complete();
      onCheckRenderStatus?.();
    }} /> : null,
  };
}

type Spotlight = { box: Box; radius: number };

/** A percentage radius only resolves against the element it came from. */
function resolvedRadius(value: string, box: Box): number {
  if (value.endsWith("%")) return (Number.parseFloat(value) / 100) * Math.min(box.width, box.height);
  return Number.parseFloat(value) || 0;
}

function findTourTarget(target?: string, fallback?: string): { element: HTMLElement; usedFallback: boolean } | null {
  const find = (name?: string) => name ? document.querySelector<HTMLElement>(`[data-tour="${name}"]`) : null;
  const preferred = find(target);
  if (preferred) return { element: preferred, usedFallback: false };
  const alternate = find(fallback);
  return alternate ? { element: alternate, usedFallback: true } : null;
}

function measureSpotlight(element: HTMLElement): Spotlight | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const box: Box = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  return { box, radius: resolvedRadius(getComputedStyle(element).borderTopLeftRadius, box) };
}

function TutorialOverlay({ step, target, stepIndex, total, snapshot = {}, celebration, onNext, onBack, onSkip, onDoItForMe, onCheckRenderStatus }: {
  step: TourStep;
  target?: string;
  stepIndex: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onDoItForMe: () => void;
  onCheckRenderStatus: () => void;
  snapshot?: TourSnapshot;
  celebration?: string | null;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [ringVisible, setRingVisible] = useState(true);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [cardPlacement, setCardPlacement] = useState<"bottom" | "top">("bottom");
  const [cardStyle, setCardStyle] = useState<React.CSSProperties>();
  const [doItVisible, setDoItVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (step.kind !== "action") {
      setDoItVisible(false);
      return;
    }
    setDoItVisible(false);
    const timer = window.setTimeout(() => setDoItVisible(true), 10000);
    return () => window.clearTimeout(timer);
  }, [step]);
  useEffect(() => {
    const found = findTourTarget(target, step.fallbackTarget);
    setUsedFallback(found?.usedFallback ?? false);
    if (!found) {
      setSpotlight(null);
      setCardPlacement("bottom");
      setCardStyle(undefined);
      return;
    }
    const targetElement = found.element;
    targetElement.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    let frame = 0;
    const measure = () => {
      frame = window.requestAnimationFrame(() => {
        setSpotlight(measureSpotlight(targetElement));
        setViewport({ width: window.innerWidth, height: window.innerHeight });
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [reducedMotion, step.fallbackTarget, target]);
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !spotlight) {
      setCardPlacement("bottom");
      setCardStyle(undefined);
      setRingVisible(true);
      return;
    }
    const cardHeight = card.getBoundingClientRect().height;
    const width = Math.min(632, window.innerWidth - 28);
    const left = Math.max(14, Math.min(window.innerWidth - width - 14, spotlight.box.left + (spotlight.box.width - width) / 2));
    const placement = tooltipPlacement(spotlight.box, cardHeight, window.innerHeight);
    setCardPlacement(placement.placement);
    setRingVisible(placement.ringVisible);
    setCardStyle({ top: placement.top, left, right: "auto", bottom: "auto", width });
  }, [celebration, spotlight, target]);
  useEffect(() => {
    const targetElement = findTourTarget(target, step.fallbackTarget)?.element;
    const first = cardRef.current?.querySelector<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])");
    if (step.kind === "action") {
      targetElement?.querySelector<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")?.focus();
    } else {
      first?.focus();
    }
  }, [step, target]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onSkip]);
  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onSkip();
      return;
    }
    if (step.kind !== "info" || event.key !== "Tab" || !cardRef.current) return;
    const focusable = [...cardRef.current.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const isFinale = step.id === "done";
  const isLastStep = stepIndex === total - 1;
  const fallbackCopy = usedFallback ? step.fallbackCopy : undefined;
  const instruction = fallbackCopy ? fallbackCopy.instruction : step.instruction;
  const body = isFinale ? finaleCopy(snapshot) : celebration ?? fallbackCopy?.body ?? step.body;
  const cutout = spotlight ? spotlightBox(spotlight.box) : null;

  return (
    <div className={`tutorial-overlay${reducedMotion ? " tutorial-reduced-motion" : ""}`} data-tour-overlay onKeyDown={trapFocus}>
      {spotlight && cutout && (
        <>
          <svg className="tutorial-scrim" aria-hidden="true">
            <path className="tutorial-scrim-fill" fillRule="evenodd" d={scrimPath(viewport, cutout, cutoutRadius(spotlight.box, spotlight.radius))} />
          </svg>
          {ringVisible && (
            <svg className={`tutorial-ring${celebration ? " is-celebrating" : ""}`} aria-hidden="true">
              <path d={ringPath(spotlight.box, spotlight.radius)} strokeWidth={RING_WIDTH} />
            </svg>
          )}
          {celebration && <Check className="tutorial-check" size={24} style={{ left: spotlight.box.left + spotlight.box.width / 2 - 12, top: spotlight.box.top + spotlight.box.height / 2 - 12 }} />}
        </>
      )}
      <div ref={cardRef} className={`soft-card card-padding-md tutorial-card${cardPlacement === "top" ? " is-top" : ""}`} style={cardStyle} role="dialog" aria-labelledby="tutorial-title">
        {!isLastStep && <button type="button" className="tutorial-skip" onClick={onSkip}>Skip tour</button>}
        <div className="tutorial-progress">
          <div className="tutorial-step-count">Step {stepIndex + 1} of {total}</div>
          <div className="tutorial-dots" aria-hidden="true">
            {Array.from({ length: total }, (_, index) => <span key={index} className={`tutorial-dot${index === stepIndex ? " is-current" : ""}${index < stepIndex ? " is-done" : ""}`} />)}
          </div>
        </div>
        <h2 id="tutorial-title">{step.title}</h2>
        <p aria-live={step.kind === "action" ? "polite" : undefined}>{body}</p>
        {step.kind === "action" && !celebration && instruction && <p className="tutorial-instruction">{instruction}</p>}
        {isFinale && shouldOfferRenderStatus(snapshot) && <button type="button" className="tutorial-status-link" onClick={onCheckRenderStatus}>Check render status <ArrowRight size={14} /></button>}
        <div className="tutorial-actions">
          {step.kind === "action" && !celebration && !fallbackCopy && step.autoAction && <button type="button" className={`tutorial-do-it${doItVisible ? " is-visible" : ""}`} onClick={onDoItForMe} tabIndex={doItVisible ? 0 : -1}>{step.autoAction}</button>}
          {stepIndex > 0 && <button type="button" className="tutorial-back" onClick={onBack}><ArrowLeft size={15} /> Back</button>}
          <button type="button" className="ui-button ui-button-primary tutorial-next" onClick={onNext}>{isLastStep ? "Done" : "Next"} <ArrowRight size={15} /></button>
        </div>
      </div>
      {spotlight && <span className="sr-only">The highlighted control is directly interactive.</span>}
      {isFinale && !reducedMotion && <ConfettiBurst />}
    </div>
  );
}

function ConfettiBurst() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const root = getComputedStyle(document.documentElement);
    const colors = ["--brand", "--success", "--link", "--warning"].map((name) => root.getPropertyValue(name).trim()).filter(Boolean);
    const particles = Array.from({ length: 56 }, (_, index) => ({
      x: window.innerWidth / 2,
      y: window.innerHeight - 112,
      vx: (index % 8 - 3.5) * 1.8,
      vy: -7 - (index % 6) * 0.7,
      size: 4 + (index % 4),
      color: colors[index % colors.length] ?? "currentColor",
    }));
    const started = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const elapsed = now - started;
      context.clearRect(0, 0, canvas.width, canvas.height);
      for (const particle of particles) {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.16;
        context.fillStyle = particle.color;
        context.fillRect(particle.x, particle.y, particle.size, particle.size);
      }
      if (elapsed < 1500) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, canvas.width, canvas.height);
    };
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvasRef} className="tutorial-confetti" aria-hidden="true" />;
}
