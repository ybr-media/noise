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
  played?: boolean;
};
export type TourStep = {
  id: string;
  kind: "info" | "action";
  tab?: "design" | "queue" | "library";
  target?: string;
  event?: TourEventType;
  group?: string;
  title: string;
  body: string;
};

export function tutorialSteps(mode: TourMode): TourStep[] {
  const renderStep: TourStep = mode === "unavailable"
    ? {
      id: "render-unavailable",
      kind: "info",
      tab: "design",
      target: "design-render",
      title: "Browse, not render",
      body: "This console is browse-only — designs render elsewhere and land in the Library.",
    }
    : {
      id: "render",
      kind: "action",
      tab: "design",
      target: "design-render",
      event: "render-enqueued",
      title: "Queue a real render",
      body: "Ready? Hit Create track. This queues a real job with the engine.",
    };
  const queueStep: TourStep = mode === "unavailable"
    ? {
      id: "queue-unavailable",
      kind: "info",
      tab: "queue",
      target: "dock-queue",
      title: "Your queue",
      body: "When designs render elsewhere, their real statuses will appear here.",
    }
    : {
      id: "queue-tab",
      kind: "action",
      tab: "queue",
      target: "dock-queue",
      event: "tab-changed",
      group: "queue",
      title: "Find the job",
      body: "Your job went somewhere. Tap the Queue tab to find it.",
    };
  return [
    {
      id: "welcome",
      kind: "info",
      title: "Welcome to Noise Lab",
      body: "You're about to design a variant, render it, and hear it — for real, not a demo. Takes about two minutes.",
    },
    {
      id: "param-color",
      kind: "action",
      tab: "design",
      target: "design-params",
      event: "param-selected",
      group: "color",
      title: "Start with a color",
      body: "Every track starts here. Tap a color — white, green, pink, or brown. The same choices always make the same sound.",
    },
    {
      id: "param-shape",
      kind: "action",
      tab: "design",
      target: "design-params",
      event: "param-selected",
      group: "shape",
      title: "Shape the sound",
      body: "Now shape it: pick a texture, motion, or mix. Watch the caption update — that's your variant's fingerprint.",
    },
    {
      id: "fx",
      kind: "action",
      tab: "design",
      target: "design-fx",
      event: "fx-changed",
      title: "Try a tone preset",
      body: "EQ and reverb shape the render itself, not just the preview. Try a preset — Flat and Off are always safe to come back to.",
    },
    renderStep,
    queueStep,
    {
      id: "queue-status",
      kind: "info",
      tab: "queue",
      target: "queue-job",
      title: "Real status, no fake progress",
      body: "There it is — Queued, then Rendering, then Done. You don't have to wait here.",
    },
    {
      id: "library-tab",
      kind: "action",
      tab: "library",
      target: "dock-library",
      event: "tab-changed",
      group: "library",
      title: "Open the Library",
      body: "Finished masters live in the Library. Tap the Library tab.",
    },
    {
      id: "track-play",
      kind: "action",
      tab: "library",
      target: "library-track",
      event: "track-played",
      title: "Hear your master",
      body: "Press play on this track. Masters here are QA'd and downloadable — the master plus its three stems.",
    },
    {
      id: "library-naming",
      kind: "info",
      tab: "library",
      target: "library-naming",
      title: "Approve what you publish",
      body: "Titles can be suggested for you, but nothing is written until you approve it. Releases bundle approved masters into a publishable set.",
    },
    {
      id: "done",
      kind: "info",
      title: "You did the whole loop",
      body: "You designed a variant, queued a render, and played your first master. Replay this any time from the info button.",
    },
  ];
}

export function tourEventMatches(step: TourStep, event: TourEvent): boolean {
  return step.kind === "action"
    && step.event === event.type
    && (!step.group || step.group === event.group);
}

export function shouldPersistTutorial(authConfigured: boolean, replay: boolean): boolean {
  return authConfigured && !replay;
}

export function finaleCopy(snapshot: TourSnapshot): string {
  const playback = snapshot.played === false ? "your first master is ready to play" : "played your first master";
  return `You did the whole loop: designed ${snapshot.params ?? "your variant"}, queued ${snapshot.renderLabel ?? "a real render"}, and ${playback}. We'll ping you here when your render is done. Replay this any time from the info button.`;
}

export function shouldFireRenderBanner(alreadyShown: boolean, status: string | undefined): boolean {
  return !alreadyShown && status === "Done";
}

type TutorialProps = {
  mode: TourMode;
  authConfigured: boolean;
  onDoItForMe?: (step: TourStep) => void;
  snapshot?: TourSnapshot;
};

export function useTutorial({ mode, authConfigured, onDoItForMe, snapshot = {} }: TutorialProps) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [celebration, setCelebration] = useState<string | null>(null);
  const onDoItForMeRef = useRef(onDoItForMe);
  const activeRef = useRef(active);
  const stepsRef = useRef<TourStep[]>([]);
  const replayRef = useRef(false);
  const celebrationTimerRef = useRef<number | null>(null);
  onDoItForMeRef.current = onDoItForMe;
  const steps = useMemo(() => tutorialSteps(mode), [mode]);
  activeRef.current = active;
  stepsRef.current = steps;
  const step = steps[stepIndex] ?? steps[0];

  const complete = useCallback(() => {
    setActive(false);
    if (shouldPersistTutorial(authConfigured, replayRef.current)) void fetch("/api/me/tutorial", { method: "POST" });
  }, [authConfigured]);
  const start = useCallback((options?: { replay?: boolean }) => {
    replayRef.current = options?.replay ?? false;
    setStepIndex(0);
    setCelebration(null);
    setActive(true);
  }, []);
  const notify = useCallback((type: TourEventType, group?: string, meta?: TourEventMeta) => {
    if (!activeRef.current) return;
    void meta;
    setStepIndex((current) => {
      const currentSteps = stepsRef.current;
      const currentStep = currentSteps[current];
      if (!tourEventMatches(currentStep, { type, group })) return current;
      if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current);
      const message = type === "render-enqueued" ? "Queued. That's a real render job." : "Nice — that's exactly it.";
      setCelebration(message);
      try { navigator.vibrate?.(10); } catch { /* vibration is optional */ }
      celebrationTimerRef.current = window.setTimeout(() => {
        setCelebration(null);
        setStepIndex(Math.min(current + 1, currentSteps.length - 1));
      }, 420);
      return current;
    });
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
    overlay: active ? <TutorialOverlay step={step} stepIndex={stepIndex} total={steps.length} snapshot={snapshot} celebration={celebration} onNext={() => (stepIndex === steps.length - 1 ? complete() : setStepIndex((current) => current + 1))} onBack={() => setStepIndex((current) => Math.max(0, current - 1))} onSkip={skip} onDoItForMe={doItForMe} /> : null,
  };
}

function TutorialOverlay({ step, stepIndex, total, snapshot = {}, celebration, onNext, onBack, onSkip, onDoItForMe }: {
  step: TourStep;
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
    const target = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    if (!target) {
      setRect(null);
      return;
    }
    target.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    let frame = 0;
    const measure = () => {
      frame = window.requestAnimationFrame(() => {
        const next = target.getBoundingClientRect();
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
  }, [reducedMotion, step]);
  useEffect(() => {
    const target = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    const first = cardRef.current?.querySelector<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])");
    if (step.kind === "action") {
      target?.querySelector<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")?.focus();
    } else {
      first?.focus();
    }
  }, [step]);
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
          <div className="tutorial-blocker tutorial-blocker-left" style={{ top: rect.top, width: rect.left, height: rect.height }} />
          <div className="tutorial-blocker tutorial-blocker-right" style={{ top: rect.top, left: rect.right, height: rect.height }} />
          <div className="tutorial-blocker tutorial-blocker-bottom" style={{ top: rect.bottom }} />
          <svg className={`tutorial-ring${celebration ? " is-celebrating" : ""}`} aria-hidden="true">
            <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} rx="16" />
          </svg>
          {celebration && <Check className="tutorial-check" size={24} style={{ left: rect.left + rect.width / 2 - 12, top: rect.top + rect.height / 2 - 12 }} />}
        </>
      )}
      <div ref={cardRef} className="soft-card card-padding-md tutorial-card" role="dialog" aria-labelledby="tutorial-title">
        <button type="button" className="tutorial-skip" onClick={onSkip}>Skip</button>
        <div className="tutorial-step-count" aria-hidden="true">{Array.from({ length: total }, (_, index) => <span key={index} className={index === stepIndex ? "is-active" : ""} />)}</div>
        <span className="sr-only">Step {stepIndex + 1} of {total}</span>
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
