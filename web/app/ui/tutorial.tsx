"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";

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
  event?: TourEventType;
  group?: string;
  eventSequence?: readonly TourEventSpec[];
  title: string;
  body: string;
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
      body: "Create track queues a real job with the engine: full-length master plus stems. Nothing here is a mock.",
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
      title: "Real status, no fake progress",
      body: "This line follows your render on every tab — Queued, then Running, then Ready. Tap it for the full detail. You don't have to wait here; we'll tell you when it lands.",
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
    },
    {
      id: "fx",
      kind: "action",
      tab: "create",
      target: "create-fx",
      event: "fx-changed",
      title: "Optional: EQ and reverb",
      body: "EQ presets — Warm Bed, Airy, Midnight, Telephone — are starting points you can nudge band by band, whether EQ is already on or you switch it on. Reverb adds a room. Both bake into the render, not just the preview.",
    },
    renderStep,
    progressStep,
    {
      id: "library-play",
      kind: "action",
      tab: "library",
      target: "dock-library",
      eventSequence: [
        { type: "tab-changed", group: "library", target: "dock-library" },
        { type: "track-played", target: "library-track" },
      ],
      title: "Hear a master",
      body: "Finished masters live in Library. Press play. Each one carries its own QA numbers and downloads as the master, a single stem, or all of it as a zip.",
    },
    {
      id: "done",
      kind: "info",
      title: "That's the loop",
      body: "Rename a track with the sparkle button, and bundle approved masters under Releases in your Library when you're ready. Replay this any time from the (i) button.",
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
  const queued = snapshot.renderStatus === "Queued" || snapshot.renderStatus === "Rendering"
    ? " Your render is still queued."
    : "";
  return `You designed ${snapshot.params ?? "your sound"}, queued ${snapshot.renderLabel ?? "your track"}, and ${playback}.${queued} Rename a track with the sparkle button, and bundle approved masters under Releases in your Library when you're ready. Replay this any time from the (i) button.`;
}

export function shouldFireRenderBanner(alreadyShown: boolean, status: string | undefined): boolean {
  return !alreadyShown && status === "Done";
}

type TutorialProps = {
  mode: TourMode;
  authConfigured: boolean;
  onDoItForMe?: (step: TourStep) => void;
  onComplete?: () => void;
  snapshot?: TourSnapshot;
};

export function useTutorial({ mode, authConfigured, onDoItForMe, onComplete, snapshot = {} }: TutorialProps) {
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
    const message = type === "render-enqueued" ? "Queued. That's a real render job." : "Nice — that's exactly it.";
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
    }} onSkip={skip} onDoItForMe={doItForMe} /> : null,
  };
}

function TutorialOverlay({ step, target, stepIndex, total, snapshot = {}, celebration, onNext, onBack, onSkip, onDoItForMe }: {
  step: TourStep;
  target?: string;
  stepIndex: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onDoItForMe: () => void;
  snapshot?: TourSnapshot;
  celebration?: string | null;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
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
    const targetElement = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
    if (!targetElement) {
      setRect(null);
      setCardPlacement("bottom");
      setCardStyle(undefined);
      return;
    }
    targetElement.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    let frame = 0;
    const measure = () => {
      frame = window.requestAnimationFrame(() => {
        const next = targetElement.getBoundingClientRect();
        setRect(next.width > 0 && next.height > 0 ? next : null);
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
  }, [reducedMotion, target]);
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !rect) {
      setCardPlacement("bottom");
      setCardStyle(undefined);
      return;
    }
    const cardBox = card.getBoundingClientRect();
    const width = Math.min(632, window.innerWidth - 28);
    const left = Math.max(14, Math.min(window.innerWidth - width - 14, rect.left + (rect.width - width) / 2));
    const gap = 16;
    const toast = document.querySelector<HTMLElement>(".toast")?.getBoundingClientRect();
    const overlap = (candidate: { top: number; bottom: number }) => {
      const horizontal = Math.max(0, Math.min(rect.right, left + width) - Math.max(rect.left, left));
      const targetOverlap = horizontal * Math.max(0, Math.min(rect.bottom, candidate.bottom) - Math.max(rect.top, candidate.top));
      const toastOverlap = toast
        ? Math.max(0, Math.min(toast.right, left + width) - Math.max(toast.left, left))
          * Math.max(0, Math.min(toast.bottom, candidate.bottom) - Math.max(toast.top, candidate.top))
        : 0;
      return { targetOverlap, toastOverlap };
    };
    const candidates = [
      { placement: "bottom" as const, box: { top: rect.bottom + gap, bottom: rect.bottom + gap + cardBox.height } },
      { placement: "top" as const, box: { top: rect.top - gap - cardBox.height, bottom: rect.top - gap } },
    ];
    const inViewport = ({ box }: (typeof candidates)[number]) => box.top >= 14 && box.bottom <= window.innerHeight - 14;
    const available = candidates.find(({ box }) => inViewport({ box, placement: "bottom" }) && overlap(box).targetOverlap === 0 && overlap(box).toastOverlap === 0)
      ?? candidates.find(({ box }) => inViewport({ box, placement: "bottom" }) && overlap(box).targetOverlap === 0)
      ?? candidates.find(inViewport)
      ?? (overlap(candidates[1].box).targetOverlap + overlap(candidates[1].box).toastOverlap <= overlap(candidates[0].box).targetOverlap + overlap(candidates[0].box).toastOverlap ? candidates[1] : candidates[0]);
    setCardPlacement(available.placement);
    setCardStyle({
      top: Math.max(14, Math.min(window.innerHeight - cardBox.height - 14, available.box.top)),
      left,
      right: "auto",
      bottom: "auto",
      width,
    });
  }, [celebration, rect, target]);
  useEffect(() => {
    const targetElement = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
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
  const style = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : undefined;
  const isFinale = step.id === "done";
  const body = isFinale ? finaleCopy(snapshot) : celebration ?? step.body;

  return (
    <div className={`tutorial-overlay${reducedMotion ? " tutorial-reduced-motion" : ""}`} data-tour-overlay onKeyDown={trapFocus}>
      {rect && (
        <>
          <div className="tutorial-blocker tutorial-blocker-top" style={{ height: rect.top }} />
          <div className="tutorial-blocker tutorial-blocker-left" style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
          <div className="tutorial-blocker tutorial-blocker-right" style={{ top: rect.top, left: rect.right, right: 0, height: rect.height }} />
          <div className="tutorial-blocker tutorial-blocker-bottom" style={{ top: rect.bottom, bottom: 0 }} />
          <svg className={`tutorial-ring${celebration ? " is-celebrating" : ""}`} aria-hidden="true">
            <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} rx="16" />
          </svg>
          {celebration && <Check className="tutorial-check" size={24} style={{ left: rect.left + rect.width / 2 - 12, top: rect.top + rect.height / 2 - 12 }} />}
        </>
      )}
      <div ref={cardRef} className={`soft-card card-padding-md tutorial-card${cardPlacement === "top" ? " is-top" : ""}`} style={cardStyle} role="dialog" aria-labelledby="tutorial-title">
        <button type="button" className="tutorial-skip" onClick={onSkip}>Skip tour</button>
        <div className="tutorial-step-count">Step {stepIndex + 1} of {total}</div>
        <h2 id="tutorial-title">{step.title}</h2>
        <p className={step.kind === "action" ? "tutorial-instruction" : undefined} aria-live={step.kind === "action" ? "polite" : undefined}>{body}</p>
        <div className="tutorial-actions">
          {step.kind === "action" && !celebration && <button type="button" className={`tutorial-do-it${doItVisible ? " is-visible" : ""}`} onClick={onDoItForMe} tabIndex={doItVisible ? 0 : -1}>Do it for me</button>}
          {step.kind === "info" && stepIndex > 0 && <button type="button" className="tutorial-back" onClick={onBack}><ArrowLeft size={15} /> Back</button>}
          {step.kind === "info" && <button type="button" className="ui-button ui-button-primary tutorial-next" onClick={onNext}>{stepIndex === total - 1 ? "Done" : "Next"} <ArrowRight size={15} /></button>}
        </div>
      </div>
      {style && <span className="sr-only">The highlighted control is directly interactive.</span>}
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
