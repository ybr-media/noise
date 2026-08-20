"use client";

import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  Info,
  Layers,
  LayoutGrid,
  List,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Save,
  ChevronLeft,
  LibraryBig,
  MoreHorizontal,
  Rocket,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import type { LibraryTrack, QueueJob, Release, ReleaseTrack, Variant } from "@/lib/types";
import type { DismissalRecord } from "@/lib/dismissals";
import { absoluteTime, batchMembersForJob, knownVariantId, queuedJobsAhead, relativeTime, renderEstimate } from "@/lib/eta";
import { groupCompletedByDay, partitionRenderJobs, type RenderJob } from "@/lib/render-jobs";
import { queueStrings } from "@/lib/queue-strings";
import { formatDisplayName, formatQueueDisplayName, OPTIONS } from "@/lib/variant-labels";
import { usePullRefresh } from "@/lib/use-pull-refresh";
import type { DerivedRelease } from "@/lib/releases";
import { toReleaseDocument } from "@/lib/release-document";
import { mulberry32, renderCoverArt, type CoverArtDimensions } from "@/lib/cover-art";
import {
  EQ_BAND_HZ,
  EQ_MAX_ABS_DB,
  EQ_PRESET_LABELS,
  EQ_PRESETS,
  REVERB_PRESET_LABELS,
  REVERB_PRESETS,
  defaultFx,
  eqIsFlat,
  eqPresetState,
  eqResponseDb,
  formatBandLabel,
  formatTail,
  fxBadges,
  reverbIsOff,
  reverbPresetState,
  reverbTailSeconds,
  toFxBlock,
  wetGainDb,
  type EqPreset,
  type EqState,
  type FxState,
  type ReverbPreset,
  type ReverbState,
} from "@/lib/fx";
import { lintNames } from "@/lib/name-lint";
import { formatBytes } from "@/lib/format";
import { BellMark } from "./bell-mark";
import { TOKENS } from "./ui/tokens";
import { Card } from "./ui/card";
import { Chip } from "./ui/chip";
import { StatusPill } from "./ui/status-pill";
import { Button } from "./ui/button";
import { Banner } from "./ui/banner";
import { EmptyState } from "./ui/empty-state";
import { Disclosure } from "./ui/disclosure";
import { useFirstRun } from "@/lib/use-first-run";
import { playedTrackIdAfterPlayback, useTutorial, type TourStep, type TourSnapshot } from "./ui/tutorial";
import { Switch } from "./ui/switch";

const TAB_ICONS = {
  design: SlidersHorizontal,
  queue: Layers,
  library: LibraryBig,
  releases: Rocket,
} as const;

const SWATCH_FILLS: Record<string, string> = {
  white: "#F6F6F4",
  green: "#3FAE62",
  pink: "#F0A3C0",
  brown: "#7A4A2B",
};

const DARK_CHECK_SWATCHES = new Set(["white", "pink"]);

const PARAM_CAPTIONS: Record<string, string> = {
  white: "White · 0 dB/oct",
  green: "Green · mid-weighted",
  pink: "Pink · −3 dB/oct",
  brown: "Brown · −6 dB/oct",
  "low-mid": "Low-mid — low-mid texture",
  mid: "Mid — mid texture",
  high: "High — high texture",
  broad: "Broad — full spectrum",
  still: "Still — static",
  drift: "Drift — drift modulation",
  breathing: "Breathing — breathing modulation",
  "bed-forward": "Bed — bed-forward mix",
  balanced: "Even — even mix",
  "texture-forward": "Texture — texture-forward mix",
};

const PARAM_ARIA_LABELS: Record<string, string> = {
  "bed-forward": "Bed",
  balanced: "Even",
  "texture-forward": "Texture",
};

function ParamIcon({ option }: { option: string }) {
  switch (option) {
    case "low-mid":
      return (
        <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden="true">
          <rect x="3" y="6" width="3" height="9" rx="1.2" fill="currentColor" />
          <rect x="8.5" y="10" width="3" height="5" rx="1.2" fill="currentColor" opacity=".4" />
          <rect x="14" y="12" width="3" height="3" rx="1.2" fill="currentColor" opacity=".4" />
        </svg>
      );
    case "mid":
      return (
        <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden="true">
          <rect x="3" y="11" width="3" height="4" rx="1.2" fill="currentColor" opacity=".4" />
          <rect x="8.5" y="5" width="3" height="10" rx="1.2" fill="currentColor" />
          <rect x="14" y="11" width="3" height="4" rx="1.2" fill="currentColor" opacity=".4" />
        </svg>
      );
    case "high":
      return (
        <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden="true">
          <rect x="3" y="12" width="3" height="3" rx="1.2" fill="currentColor" opacity=".4" />
          <rect x="8.5" y="10" width="3" height="5" rx="1.2" fill="currentColor" opacity=".4" />
          <rect x="14" y="5" width="3" height="10" rx="1.2" fill="currentColor" />
        </svg>
      );
    case "broad":
      return (
        <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden="true">
          <rect x="3" y="7" width="3" height="8" rx="1.2" fill="currentColor" />
          <rect x="8.5" y="7" width="3" height="8" rx="1.2" fill="currentColor" />
          <rect x="14" y="7" width="3" height="8" rx="1.2" fill="currentColor" />
        </svg>
      );
    case "still":
      return (
        <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden="true">
          <path d="M3 10h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "drift":
      return (
        <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden="true">
          <path d="M3 13C7 12 12 8 17 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "breathing":
      return (
        <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden="true">
          <path d="M3 10c2.3-5 4.7-5 7 0s4.7 5 7 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "bed-forward":
      return (
        <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden="true">
          <rect x="3" y="11" width="14" height="4" rx="1.5" fill="currentColor" />
          <rect x="5" y="5" width="10" height="4" rx="1.5" fill="currentColor" opacity=".35" />
        </svg>
      );
    case "balanced":
      return (
        <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden="true">
          <rect x="3" y="5" width="14" height="4" rx="1.5" fill="currentColor" />
          <rect x="3" y="11" width="14" height="4" rx="1.5" fill="currentColor" />
        </svg>
      );
    case "texture-forward":
      return (
        <svg viewBox="0 0 20 20" width={20} height={20} fill="none" aria-hidden="true">
          <rect x="3" y="11" width="14" height="4" rx="1.5" fill="currentColor" opacity=".35" />
          <circle cx="6" cy="7" r="1.6" fill="currentColor" />
          <circle cx="11" cy="5.5" r="1.6" fill="currentColor" />
          <circle cx="15" cy="8" r="1.6" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}

function radioArrowHandler(options: readonly (readonly [string, string])[], value: string, onChange: (value: string) => void) {
  return (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = options.findIndex(([id]) => id === value);
    const [nextId] = options[(index + delta + options.length) % options.length];
    fireSelectionHaptic();
    onChange(nextId);
    const next = event.currentTarget.querySelector<HTMLButtonElement>(`[data-option="${nextId}"]`);
    next?.focus();
  };
}

function fireSelectionHaptic() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try { navigator.vibrate(10); } catch {}
  }
}

function GlyphSegmented({ options, value, onChange, label, icon }: {
  options: readonly (readonly [string, string])[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  icon?: (option: string) => React.ReactNode;
}) {
  return (
    <div className="glyph-segmented" role="radiogroup" aria-label={label} onKeyDown={radioArrowHandler(options, value, onChange)}>
      {options.map(([id, name]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} tabIndex={value === id ? 0 : -1} data-option={id}
          aria-label={PARAM_ARIA_LABELS[id] ?? name} title={name}
          onClick={() => { if (value !== id) fireSelectionHaptic(); onChange(id); }}
          className={`glyph-segment ${value === id ? "is-selected" : ""}`}>
          {icon ? icon(id) : <ParamIcon option={id} />}
        </button>
      ))}
    </div>
  );
}

function FxPresetIcon({ option }: { option: string }) {
  const paths: Record<string, React.ReactNode> = {
    "warm-bed": <path d="M2.5 14c1.8-5 3.6-6.5 5.4-4.5s3.2 2.7 4.8 1.2 2.8-3.2 4.8-3.2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />,
    airy: <path d="M2.5 14c2.2 1.2 3.7.5 5.2-1.5s2.8-4.8 4.7-5.2 3.2.7 5.1-3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />,
    midnight: <path d="M2.5 5c2.1 2.7 3.8 3.8 5.3 3.3s2.7-1.4 4.5.1 3.1 4.2 5.2 6.6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />,
    telephone: <path d="M2.5 13h4l1.2-5.5h4.6l1.2 5.5h4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
    custom: <path d="M4 5h12M4 10h12M4 15h12M7 3v4M13 8v4M9 13v4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />,
  };
  const reverbArcShapes: Record<string, { radii: readonly number[]; heights: readonly number[]; walls?: "short" | "tall" }> = {
    "small-room": { radii: [2.5], heights: [2.3] },
    "medium-room": { radii: [2.5, 4.3], heights: [2.3, 3.9] },
    "large-room": { radii: [2.5, 4.3, 6.1], heights: [2.3, 3.9, 5.5] },
    "church-hall": { radii: [2.5, 4.3, 6.1, 7.9], heights: [1.8, 3.1, 4.4, 5.3], walls: "short" },
    cathedral: { radii: [2.5, 4.3, 6.1, 7.9, 9.4], heights: [2.5, 4.2, 5.9, 7.2, 8.2], walls: "tall" },
  };
  const arcShape = reverbArcShapes[option];
  if (arcShape) {
    return (
      <svg viewBox="0 0 20 20" width={20} height={20} aria-hidden="true">
        <circle cx="10" cy="15.5" r="1.2" fill="currentColor" />
        {arcShape.radii.map((radius, index) => {
          const height = arcShape.heights[index];
          return <path key={radius} d={`M ${10 - radius} 15.5 A ${radius} ${height} 0 0 1 ${10 + radius} 15.5`} stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinecap="round" />;
        })}
        {arcShape.walls && (
          <path d={arcShape.walls === "short" ? "M3.1 12.5v3M16.9 12.5v3" : "M2.2 8.5v7M17.8 8.5v7"} stroke="currentColor" strokeWidth="1.35" fill="none" strokeLinecap="round" />
        )}
      </svg>
    );
  }
  return <svg viewBox="0 0 20 20" width={20} height={20} aria-hidden="true">{paths[option] ?? paths.custom}</svg>;
}

function SwatchRow({ options, value, onChange, label }: {
  options: readonly (readonly [string, string])[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="swatch-row" role="radiogroup" aria-label={label} onKeyDown={radioArrowHandler(options, value, onChange)}>
      {options.map(([id, name]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} tabIndex={value === id ? 0 : -1} data-option={id} aria-label={name}
          onClick={() => { if (value !== id) fireSelectionHaptic(); onChange(id); }}
          className={`swatch ${id === "white" ? "swatch-white" : ""} ${value === id ? "is-selected" : ""}`}
          style={{ background: SWATCH_FILLS[id] }}>
          {value === id && (
            <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
              <path d="M3 7.5l2.5 2.5L11 4.5" stroke={DARK_CHECK_SWATCHES.has(id) ? TOKENS.ink : TOKENS.white} strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

function ParamRow({ label, caption, children }: { label: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="param-row">
      <div className="param-row-heading">
        <div className="param-title">{label}</div>
        <div className="param-caption" aria-live="polite">
          <span key={caption} className="param-caption-text">{caption}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

type ToastState = { message: string; error?: boolean; action?: { label: string; onClick: () => void } };

function Toast({ message, error, action, onClose }: ToastState & { onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="toast" style={{ background: error ? TOKENS.brand : TOKENS.ink }} role="status" aria-live="polite">
      {error ? <AlertCircle size={17} color={TOKENS.white} /> : <Check size={17} color={TOKENS.white} />}
      <span className="flex-1 text-sm leading-5 text-white">{message}</span>
      {action && <button type="button" className="toast-action" onClick={action.onClick}>{action.label}</button>}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="toast-dismiss"><X size={16} color={TOKENS.white} /></button>
    </div>
  );
}

function Skeleton({ width, height, radius, className }: { width?: number | string; height?: number | string; radius?: number | string; className?: string }) {
  return <span aria-hidden="true" className={`skeleton ${className ?? ""}`} style={{ width, height, borderRadius: radius }} />;
}

function SkeletonPanel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="skeleton-panel" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

function DesignSkeleton() {
  return (
    <SkeletonPanel label="Loading design controls…">
      <div className="design-stack">
        <Card as="section" padding="md" className="spectrum-card">
          <div className="spectrum-frame"><Skeleton height="100%" radius={16} /></div>
          <div className="spectrum-ticks"><Skeleton width={38} height={13} /><Skeleton width={28} height={13} /><Skeleton width={20} height={13} /><Skeleton width={24} height={13} /></div>
        </Card>
        <div className="action-row">
          <Skeleton className="skeleton-fixed skeleton-play-button" />
          <Skeleton className="skeleton-grow skeleton-action-button" />
        </div>
        <Card as="section" padding="md" className="controls-card">
          {["color", "band", "motion", "balance"].map((row, index) => (
            <div key={row} className="param-row">
              <div className="param-row-heading"><div className="param-title"><Skeleton width={68} height={16} /></div><div className="param-caption"><Skeleton width={120} height={12} /></div></div>
              {index === 0 ? <div className="swatch-row">{[0, 1, 2, 3].map((swatch) => <Skeleton key={swatch} width={38} height={38} radius="50%" />)}</div> : <Skeleton height={48} radius={16} />}
            </div>
          ))}
        </Card>
        {["eq", "reverb"].map((fx) => (
          <Card as="section" key={fx} padding="md" className="controls-card">
            <div className="param-row">
              <div className="param-row-heading">
                <div className="param-title"><Skeleton width={fx === "eq" ? 30 : 56} height={16} /></div>
                <div className="param-row-heading-actions"><div className="param-caption"><Skeleton width={42} height={12} /></div><Skeleton className="skeleton-fixed" width={44} height={28} radius={999} /></div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </SkeletonPanel>
  );
}

function LibrarySkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <SkeletonPanel label="Loading rendered masters…">
      <div className="library-toolbar"><div className="section-title"><Skeleton width={96} height={14} /></div><Skeleton className="icon-action view-toggle skeleton-fixed" width={34} height={34} radius="50%" /></div>
      <div className="library-list">
        {compact ? [0, 1, 2].map((card) => (
          <Card as="article" key={card} padding="md" className="track-row">
            <Skeleton className="player-play track-row-play skeleton-fixed" width={32} height={32} radius="50%" />
            <div className="skeleton-row-body"><Skeleton width="68%" height={14} /><Skeleton width="54%" height={11} /></div>
            <Skeleton className="icon-action track-row-download skeleton-fixed" width={34} height={34} radius="50%" />
          </Card>
        )) : [0, 1, 2].map((card) => (
          <Card as="article" key={card} padding="md" className="track-card">
            <div className="track-card-heading"><Skeleton width="58%" height={15} /><Skeleton className="skeleton-fixed" width={34} height={34} radius="50%" /></div>
            <div className="track-chips"><Skeleton width={74} height={28} radius={999} /><Skeleton width={48} height={28} radius={999} /><Skeleton width={52} height={28} radius={999} /><Skeleton width={58} height={28} radius={999} /></div>
            <Skeleton className="track-date" width="44%" height={11} />
            <div className="custom-player"><Skeleton height={28} radius={999} /></div>
            <div className="qa-strip"><Skeleton height={52} /></div>
            <div className="download-menu-wrap"><div className="download-split"><Skeleton height={42} radius={999} /></div></div>
          </Card>
        ))}
      </div>
    </SkeletonPanel>
  );
}

function QueueSkeleton() {
  return (
    <SkeletonPanel label="Loading render queue…">
      {[{ width: 128, cards: 2 }, { width: 76, cards: 1 }].map((group, groupIndex) => (
        <section key={groupIndex} className="queue-group queue-section">
          <div className="section-title"><Skeleton width={group.width} height={14} /></div>
          <div className="queue-job-list">{Array.from({ length: group.cards }, (_, card) => (
            <Card as="article" key={card} padding="md">
              <div className="queue-title-row"><Skeleton className="queue-name" width={groupIndex ? "52%" : "58%"} height={17} />{groupIndex === 0 ? <Skeleton className="icon-action queue-overflow skeleton-fixed" width={34} height={34} radius="50%" /> : <Skeleton className="status-pill skeleton-fixed" width={58} height={28} radius={999} />}</div>
              <div className="queue-chips"><Skeleton width={74} height={28} radius={999} /><Skeleton width={48} height={28} radius={999} /><Skeleton width={52} height={28} radius={999} /><Skeleton width={58} height={28} radius={999} /></div>
              {groupIndex === 1 && <Skeleton className="queue-active-copy" width="34%" height={12} />}
              <Skeleton className="queue-meta" width="28%" height={12} />
              {groupIndex === 0 && <div className="queue-card-actions"><Skeleton height={46} radius={999} /><Skeleton height={46} radius={999} /></div>}
            </Card>
          ))}</div>
        </section>
      ))}
    </SkeletonPanel>
  );
}

function ReleasesSkeleton() {
  return (
    <SkeletonPanel label="Loading releases…">
      <div className="release-list">
        {[0, 1, 2].map((card) => (
          <Card as="article" key={card} padding="md" className="release-card">
            <div className="release-card-heading">
              <div className="min-w-0 flex-1"><Skeleton width={72} height={11} /><Skeleton className="mt-2" width="58%" height={21} /><Skeleton className="mt-2" width="42%" height={12} /></div>
              <Skeleton className="skeleton-fixed" width={58} height={28} radius={999} />
            </div>
            <div className="release-checklist"><Skeleton width={64} height={12} /><Skeleton width={48} height={12} /><Skeleton width={56} height={12} /><Skeleton width="70%" height={12} /></div>
          </Card>
        ))}
      </div>
    </SkeletonPanel>
  );
}

function formatCreatedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatQueueDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

function drawEqCurve(ctx: CanvasRenderingContext2D, width: number, gainsDb: number[], flat: boolean) {
  const minHz = 30;
  const maxHz = 16000;
  ctx.save();
  if (flat) {
    ctx.strokeStyle = TOKENS.separator;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 75);
    ctx.lineTo(width, 75);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const points: [number, number][] = [];
  for (let x = 0; x <= width; x += 3) {
    const hz = minHz * Math.pow(maxHz / minHz, x / width);
    const db = eqResponseDb(gainsDb, hz);
    points.push([x, 75 - (db / EQ_MAX_ABS_DB) * 60]);
  }
  ctx.beginPath();
  points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.strokeStyle = "rgba(0,122,255,0.75)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineTo(width, 150);
  ctx.lineTo(0, 150);
  ctx.closePath();
  ctx.fillStyle = "rgba(0,122,255,0.08)";
  ctx.fill();
  ctx.restore();
}

function Spectrum({ analyser, playing, eqGains, eqBadge }: { analyser: AnalyserNode | null; playing: boolean; eqGains: number[]; eqBadge: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = 150 * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const width = canvas.clientWidth;
    ctx.strokeStyle = TOKENS.track;
    ctx.lineWidth = 1;
    for (let y = 22; y < 140; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    const flat = eqGains.every((gain) => gain === 0);
    drawEqCurve(ctx, width, eqGains, flat);
    if (!analyser || !playing) return;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, TOKENS.brand);
    gradient.addColorStop(0.45, TOKENS.orange);
    gradient.addColorStop(1, TOKENS.link);
    let frame = 0;
    const draw = () => {
      analyser.getByteFrequencyData(bins);
      ctx.clearRect(0, 0, width, 150);
      ctx.strokeStyle = TOKENS.track;
      ctx.lineWidth = 1;
      for (let y = 22; y < 140; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      drawEqCurve(ctx, width, eqGains, eqGains.every((gain) => gain === 0));
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const maxBin = Math.min(bins.length, 512);
      for (let x = 0; x < width; x += 2) {
        const bin = Math.min(maxBin - 1, Math.floor((x / width) * maxBin));
        const y = 138 - (bins[bin] / 255) * 112;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser, playing, eqGains]);
  return (
    <div className="relative">
      <canvas ref={ref} className="block h-[150px] w-full" aria-label="Approximate preview spectrum" />
      {eqBadge && <span className="absolute right-2 top-2 rounded-full bg-[color:var(--link-tint)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--link)]">EQ: {eqBadge}</span>}
    </div>
  );
}

function makeImpulseResponse(ctx: AudioContext, reverb: ReverbState): AudioBuffer {
  const tail = Math.max(0.2, reverbTailSeconds(reverb));
  const preDelay = reverb.preDelayMs / 1000;
  const length = Math.ceil(ctx.sampleRate * (preDelay + tail));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const preDelayFrames = Math.floor(ctx.sampleRate * preDelay);
  // One-pole lowpass whose cutoff falls with damping, applied per sample so
  // highs die faster than lows, like freeverb's damped comb filters.
  const dampCoefficient = 0.2 + (reverb.damping / 100) * 0.7;
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    const random = mulberry32(channel + 1);
    let lowpass = 0;
    for (let i = preDelayFrames; i < length; i += 1) {
      const t = (i - preDelayFrames) / (length - preDelayFrames);
      const envelope = Math.pow(1 - t, 2) * Math.exp(-4 * t);
      const noise = random() * 2 - 1;
      lowpass = lowpass * dampCoefficient + noise * (1 - dampCoefficient);
      data[i] = lowpass * envelope;
    }
  }
  return buffer;
}

function makeCrossfadedBuffer(ctx: AudioContext, seed: number, seconds = 6): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const fade = Math.floor(ctx.sampleRate * 0.25);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const random = mulberry32(seed);
  const raw = Float32Array.from({ length }, () => random() * 2 - 1);
  for (let i = 0; i < length; i += 1) {
    if (i < fade) {
      const t = i / fade;
      data[i] = raw[i] * t + raw[length - fade + i] * (1 - t);
    } else if (i >= length - fade) {
      const t = (i - (length - fade)) / fade;
      data[i] = raw[i] * (1 - t) + raw[i - (length - fade)] * t;
    } else data[i] = raw[i];
  }
  return buffer;
}

type FxNodes = {
  filters: BiquadFilterNode[];
  trim: GainNode;
  dry: GainNode;
  wet: GainNode;
  convolver: ConvolverNode;
};

function useApproxPreview(variant: Variant | undefined, fx: FxState) {
  const context = useRef<AudioContext | null>(null);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const lfos = useRef<OscillatorNode[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const fxNodes = useRef<FxNodes | null>(null);
  const reverbKey = useRef("");
  const [playing, setPlaying] = useState(false);
  const stop = useCallback(() => {
    sources.current.forEach((source) => {
      try { source.stop(); } catch {}
      source.disconnect();
    });
    sources.current = [];
    lfos.current.forEach((lfo) => {
      try { lfo.stop(); } catch {}
      lfo.disconnect();
    });
    lfos.current = [];
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    fxNodes.current = null;
    reverbKey.current = "";
    setPlaying(false);
  }, []);
  const toggle = useCallback(() => {
    if (playing) return stop();
    if (!variant) return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = context.current ?? new AudioContextClass();
    context.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    analyserRef.current = analyser;
    const master = ctx.createGain();
    master.gain.value = 0.35;
    // FX chain mirroring the render pipeline: 10-band EQ -> trim -> parallel
    // dry/convolver-wet reverb -> limiter, so presets sound like the export.
    const filters = EQ_BAND_HZ.map((hz, band) => {
      const filter = ctx.createBiquadFilter();
      filter.type = band === 0 ? "lowshelf" : band === EQ_BAND_HZ.length - 1 ? "highshelf" : "peaking";
      filter.frequency.value = hz;
      if (filter.type === "peaking") filter.Q.value = 1.4;
      filter.gain.value = fx.eq.gainsDb[band];
      return filter;
    });
    for (let band = 1; band < filters.length; band += 1) filters[band - 1].connect(filters[band]);
    const trim = ctx.createGain();
    trim.gain.value = 10 ** (fx.eq.trimDb / 20);
    filters[filters.length - 1].connect(trim);
    const dry = ctx.createGain();
    dry.gain.value = 1;
    const wet = ctx.createGain();
    const off = reverbIsOff(fx.reverb);
    wet.gain.value = off ? 0 : 10 ** (wetGainDb(fx.reverb.mixPercent) / 20);
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulseResponse(ctx, off ? { ...fx.reverb, mixPercent: 30 } : fx.reverb);
    reverbKey.current = JSON.stringify([fx.reverb.roomSize, fx.reverb.preDelayMs, fx.reverb.reverberance, fx.reverb.damping]);
    trim.connect(dry);
    trim.connect(convolver);
    convolver.connect(wet);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    dry.connect(limiter);
    wet.connect(limiter);
    limiter.connect(analyser);
    analyser.connect(ctx.destination);
    master.connect(filters[0]);
    fxNodes.current = { filters, trim, dry, wet, convolver };
    const layers = [
      { seed: variant.seeds.bed_l ?? 1, gain: variant.gainsDb.bed, type: "bed" },
      { seed: variant.seeds.texture_l ?? 2, gain: variant.gainsDb.texture, type: "texture" },
      { seed: variant.seeds.motion_l ?? 3, gain: variant.gainsDb.motion, type: "motion" },
    ];
    const nextSources: AudioBufferSourceNode[] = [];
    for (const layer of layers) {
      const source = ctx.createBufferSource();
      source.buffer = makeCrossfadedBuffer(ctx, layer.seed);
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 10 ** (layer.gain / 20);
      if (layer.type === "texture") {
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = Math.sqrt(variant.bandLowHz * variant.bandHighHz);
        band.Q.value = Math.max(0.35, band.frequency.value / Math.max(1, variant.bandHighHz - variant.bandLowHz));
        source.connect(band);
        band.connect(gain);
      } else if (layer.type === "motion") {
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = Math.min(variant.bandHighHz, 12000);
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = variant.lfoRateHz;
        lfoGain.gain.value = variant.lfoDepth * 0.5;
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);
        lfo.start();
        lfos.current.push(lfo);
        source.connect(lowpass);
        lowpass.connect(gain);
      } else {
        const color = ctx.createBiquadFilter();
        color.type = variant.color === "brown" ? "lowpass" : variant.color === "pink" ? "lowshelf" : "allpass";
        color.frequency.value = variant.color === "brown" ? 1800 : 900;
        if (color.type === "lowshelf") color.gain.value = -3;
        source.connect(color);
        color.connect(gain);
      }
      if (variant.spectrum.bell) {
        const bell = ctx.createBiquadFilter();
        bell.type = "peaking";
        bell.frequency.value = variant.spectrum.bell.centerHz;
        bell.Q.value = variant.spectrum.bell.q;
        bell.gain.value = variant.spectrum.bell.gainDb;
        gain.connect(bell);
        bell.connect(master);
      } else gain.connect(master);
      source.start();
      nextSources.push(source);
    }
    sources.current = nextSources;
    setPlaying(true);
  }, [playing, stop, variant, fx]);
  useEffect(() => stop, [variant, stop]);
  useEffect(() => {
    const nodes = fxNodes.current;
    const ctx = context.current;
    if (!nodes || !ctx || !playing) return;
    nodes.filters.forEach((filter, band) => { filter.gain.value = fx.eq.gainsDb[band]; });
    nodes.trim.gain.value = 10 ** (fx.eq.trimDb / 20);
    const off = reverbIsOff(fx.reverb);
    nodes.wet.gain.value = off ? 0 : 10 ** (wetGainDb(fx.reverb.mixPercent) / 20);
    const key = JSON.stringify([fx.reverb.roomSize, fx.reverb.preDelayMs, fx.reverb.reverberance, fx.reverb.damping]);
    if (!off && key !== reverbKey.current) {
      nodes.convolver.buffer = makeImpulseResponse(ctx, fx.reverb);
      reverbKey.current = key;
    }
  }, [fx, playing]);
  return { playing, toggle, stop, analyser: analyserRef.current };
}

const FX_STORAGE_KEY = "noise.fx";

function useFxState(variantId: string | undefined): [FxState, (update: (old: FxState) => FxState) => void] {
  const [fx, setFx] = useState<FxState>(defaultFx);
  const loadedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!variantId || loadedFor.current === variantId) return;
    loadedFor.current = variantId;
    try {
      const saved = JSON.parse(localStorage.getItem(FX_STORAGE_KEY) ?? "{}") as Record<string, FxState>;
      const stored = saved[variantId];
      setFx(stored && stored.eq && stored.reverb ? {
        ...stored,
        eq: eqIsFlat(stored.eq) ? eqPresetState("flat") : stored.eq,
        reverb: reverbIsOff(stored.reverb) ? reverbPresetState("off") : stored.reverb,
      } : defaultFx());
    } catch { setFx(defaultFx()); }
  }, [variantId]);
  const update = useCallback((mutate: (old: FxState) => FxState) => {
    setFx((old) => {
      const next = mutate(old);
      if (variantId) {
        try {
          const saved = JSON.parse(localStorage.getItem(FX_STORAGE_KEY) ?? "{}") as Record<string, FxState>;
          saved[variantId] = next;
          localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(saved));
        } catch { /* ignore storage failures */ }
      }
      return next;
    });
  }, [variantId]);
  return [fx, update];
}

function EqSection({ fx, onChange, variantId }: { fx: FxState; onChange: (update: (old: FxState) => FxState) => void; variantId?: string }) {
  const flat = eqIsFlat(fx.eq);
  const previousEq = useRef<EqState | null>(null);
  useEffect(() => { previousEq.current = null; }, [variantId]);
  const chipPresets = EQ_PRESETS.filter((preset) => preset !== "flat" && (preset !== "custom" || fx.eq.preset === "custom"));
  const toggle = () => {
    if (flat) {
      const remembered = previousEq.current;
      onChange((old) => ({ ...old, eq: remembered && !eqIsFlat(remembered) ? remembered : eqPresetState("warm-bed") }));
    } else {
      previousEq.current = fx.eq;
      onChange((old) => ({ ...old, eq: eqPresetState("flat") }));
    }
  };
  return (
    <Card as="section" padding="md" className="controls-card">
      <div className="param-row">
        <div className="param-row-heading">
          <div className="param-title">EQ</div>
          <div className="param-row-heading-actions">
            <div className="param-caption"><span className="param-caption-text">{flat ? "Off" : `${EQ_PRESET_LABELS[fx.eq.preset]} EQ`}</span></div>
            <Switch checked={!flat} aria-label="EQ on/off" onChange={toggle} />
          </div>
        </div>
        {!flat && <GlyphSegmented label="EQ preset" value={fx.eq.preset}
          options={chipPresets.map((preset) => [preset, EQ_PRESET_LABELS[preset]] as const)}
          icon={(option) => <FxPresetIcon option={option} />}
          onChange={(id) => onChange((old) => ({ ...old, eq: id === "custom" ? { ...old.eq, preset: "custom" } : eqPresetState(id as Exclude<EqPreset, "custom">) }))} />
        }
        {!flat && (
          <div className="fx-detail">
            <div className="fx-eq-grid" role="group" aria-label="EQ bands">
              {EQ_BAND_HZ.map((hz, band) => (
                <div key={hz} className="fx-eq-band">
                  <span className={`fx-eq-value${fx.eq.gainsDb[band] !== 0 ? " is-active" : ""}`}>{fx.eq.gainsDb[band] > 0 ? `+${fx.eq.gainsDb[band]}` : fx.eq.gainsDb[band]}</span>
                  <input type="range" min={-EQ_MAX_ABS_DB} max={EQ_MAX_ABS_DB} step={1} value={fx.eq.gainsDb[band]}
                    aria-label={`${formatBandLabel(hz)} Hz gain`} aria-orientation="vertical"
                    className="fx-range fx-range-vertical"
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      onChange((old) => ({ ...old, eq: { preset: "custom", trimDb: old.eq.trimDb, gainsDb: old.eq.gainsDb.map((gain, index) => (index === band ? value : gain)) } }));
                    }} />
                  <span className="fx-eq-label">{formatBandLabel(hz)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function FxSlider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void }) {
  return (
    <label className="fx-slider-field">
      <span className="fx-slider-meta"><span>{label}</span><span className="fx-slider-value">{value}{unit}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} className="fx-range fx-range-horizontal"
        style={{ "--fx-fill": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ReverbSection({ fx, onChange, nominalSeconds, variantId }: { fx: FxState; onChange: (update: (old: FxState) => FxState) => void; nominalSeconds: number; variantId?: string }) {
  const [advanced, setAdvanced] = useState(false);
  const off = reverbIsOff(fx.reverb);
  const previousReverb = useRef<ReverbState | null>(null);
  useEffect(() => { previousReverb.current = null; }, [variantId]);
  const tail = reverbTailSeconds(fx.reverb);
  const toggle = () => {
    if (off) {
      const remembered = previousReverb.current;
      onChange((old) => ({ ...old, reverb: remembered && !reverbIsOff(remembered) ? remembered : reverbPresetState("medium-room") }));
    } else {
      previousReverb.current = fx.reverb;
      onChange((old) => ({ ...old, reverb: reverbPresetState("off") }));
    }
  };
  const setReverb = (patch: Partial<ReverbState>) => onChange((old) => ({ ...old, reverb: { ...old.reverb, ...patch, preset: "custom" } }));
  return (
    <Card as="section" padding="md" className="controls-card">
      <div className="param-row">
        <div className="param-row-heading">
          <div className="param-title">Reverb</div>
          <div className="param-row-heading-actions">
            <div className="param-caption"><span className="param-caption-text">{off ? "Off" : `${REVERB_PRESET_LABELS[fx.reverb.preset]} · ${formatTail(nominalSeconds, tail)}`}</span></div>
            <Switch checked={!off} aria-label="Reverb on/off" onChange={toggle} />
          </div>
        </div>
        {!off && <GlyphSegmented label="Reverb preset" value={fx.reverb.preset}
          options={REVERB_PRESETS.filter((preset) => preset !== "off" && (preset !== "custom" || fx.reverb.preset === "custom")).map((preset) => [preset, REVERB_PRESET_LABELS[preset]] as const)}
          icon={(option) => <FxPresetIcon option={option} />}
          onChange={(id) => onChange((old) => ({ ...old, reverb: id === "custom" ? { ...old.reverb, preset: "custom" } : reverbPresetState(id as Exclude<ReverbPreset, "custom">) }))} />
        }
        {!off && (
          <div className="fx-detail">
            <FxSlider label="Room amount" value={fx.reverb.mixPercent} min={0} max={100} step={1} unit="%" onChange={(value) => setReverb({ mixPercent: value })} />
            <Disclosure open={advanced} onOpenChange={setAdvanced} summary={advanced ? "Hide advanced" : "Advanced"} triggerClassName="fx-link">
              <div className="fx-advanced-grid">
                <FxSlider label="Room size" value={fx.reverb.roomSize} min={0} max={100} step={1} unit="%" onChange={(value) => setReverb({ roomSize: value })} />
                <FxSlider label="Pre-delay" value={fx.reverb.preDelayMs} min={0} max={200} step={1} unit=" ms" onChange={(value) => setReverb({ preDelayMs: value })} />
                <FxSlider label="Decay" value={fx.reverb.reverberance} min={0} max={100} step={1} unit="%" onChange={(value) => setReverb({ reverberance: value })} />
                <FxSlider label="Damping" value={fx.reverb.damping} min={0} max={100} step={1} unit="%" onChange={(value) => setReverb({ damping: value })} />
              </div>
            </Disclosure>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function NoiseLab({ authConfigured }: { authConfigured: boolean }) {
  const firstRun = useFirstRun(authConfigured);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [releases, setReleases] = useState<DerivedRelease[]>([]);
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [queueStats, setQueueStats] = useState({ medianRenderSeconds: null as number | null, sampleSize: 0 });
  const [renderMode, setRenderMode] = useState<"local" | "dispatch" | "unavailable">("local");
  const [releaseMode, setReleaseMode] = useState<"local" | "dispatch" | "unavailable">("local");
  const [tab, setTab] = useState<"design" | "library" | "queue" | "releases">("design");
  const [releaseId, setReleaseId] = useState<string | undefined>();
  const [selection, setSelection] = useState({ color: "white", band: "mid", motion: "drift", balance: "balanced" });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLibrarySync, setLastLibrarySync] = useState<string | null>(null);
  const [lastQueueSync, setLastQueueSync] = useState<string | null>(null);
  const [librarySyncFailed, setLibrarySyncFailed] = useState(false);
  const [seenLibraryIds, setSeenLibraryIds] = useState<Set<string>>(new Set());
  const [everLoaded, setEverLoaded] = useState(false);
  const [queueRefreshing, setQueueRefreshing] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [introState, setIntroState] = useState<"visible" | "fading" | "hidden">("visible");
  const [tabInfoOpen, setTabInfoOpen] = useState(false);
  const [tabTitleVisible, setTabTitleVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [renderBanner, setRenderBanner] = useState<{ variantId: string } | null>(null);
  const [trackedRender, setTrackedRender] = useState<{ variantId: string } | null>(null);
  const [playedTrackId, setPlayedTrackId] = useState<string | null>(null);
  const libraryReturnTab = useRef<"design" | "queue" | "releases" | null>(null);
  const retryInFlight = useRef(false);
  const queueRef = useRef<(ids: string[], label: "one" | "pilot" | "full") => Promise<void>>(async () => {});
  const tabsRef = useRef<HTMLElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const queueCount = jobs.filter((job) => job.status === "Queued" || job.status === "Rendering").length;
  const libraryCount = tracks.filter((track) => track.exists && !seenLibraryIds.has(track.variantId)).length;
  const releaseCount = releases.filter((release) => release.ladder.ready && !release.ladder.submitted).length;
  const selected = useMemo(() => variants.find((variant) => variant.color === selection.color && variant.band === selection.band && variant.motion === selection.motion && variant.balance === selection.balance), [selection, variants]);
  const pilotCount = variants.filter((variant) => variant.pilot !== null).length;
  const [fx, setFx] = useFxState(selected?.variantId);
  const tourNotifyRef = useRef<(type: "param-selected" | "fx-changed" | "render-enqueued" | "tab-changed" | "track-played", group?: string, meta?: { jobId?: string; variantId?: string }) => void>(() => {});
  const onTourDoItForMe = useCallback((step: TourStep) => {
    if (step.id === "param-color") {
      setSelection((old) => ({ ...old, color: "green" }));
      tourNotifyRef.current("param-selected", "color");
    } else if (step.id === "param-shape") {
      setSelection((old) => ({ ...old, band: "broad" }));
      tourNotifyRef.current("param-selected", "shape");
    } else if (step.id === "fx") {
      setFx((old) => ({ ...old, eq: eqPresetState("warm-bed") }));
      tourNotifyRef.current("fx-changed");
    } else if (step.id === "render") {
      if (selected) void queueRef.current([selected.variantId], "one");
    } else if (step.id === "queue-tab") {
      document.querySelector<HTMLElement>('[data-tour="dock-queue"]')?.click();
    } else if (step.id === "library-play") {
      if (document.querySelector<HTMLElement>('[data-tour="dock-library"]')?.getAttribute("aria-selected") !== "true") {
        document.querySelector<HTMLElement>('[data-tour="dock-library"]')?.click();
        return;
      }
      document.querySelector<HTMLElement>('[data-tour="library-track"] .player-play')?.click();
    }
  }, [selected, setFx]);
  const tourSnapshot = useMemo<TourSnapshot>(() => ({
    params: selected ? `${OPTIONS.color.find(([value]) => value === selected.color)?.[1] ?? selected.color} · ${selected.band} · ${selected.motion}` : undefined,
    renderLabel: trackedRender ? "your track" : undefined,
    queuedVariantId: trackedRender?.variantId,
    playedTrackId,
    renderStatus: trackedRender ? jobs.find((job) => job.variantId === trackedRender.variantId)?.status ?? "Queued" : undefined,
  }), [jobs, playedTrackId, selected, trackedRender]);
  const tour = useTutorial({ mode: renderMode, authConfigured, onDoItForMe: onTourDoItForMe, onComplete: firstRun.markCompleted, snapshot: tourSnapshot });
  tourNotifyRef.current = tour.notify;
  const tourActive = tour.active;
  const startTour = tour.start;
  const preview = useApproxPreview(selected, fx);
  const queueFetchInFlight = useRef(false);
  const initialLoad = loading && !everLoaded;
  const updateFx = useCallback((update: (old: FxState) => FxState) => {
    setFx(update);
    tourNotifyRef.current("fx-changed");
  }, [setFx]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [variantResponse, libraryResponse, queueResponse, releasesResponse] = await Promise.all([fetch("/api/variants"), fetch("/api/library"), fetch("/api/queue"), fetch("/api/releases")]);
      if (![variantResponse, libraryResponse, queueResponse, releasesResponse].every((response) => response.ok)) throw new Error("Refresh failed");
      setVariants((await variantResponse.json()).variants);
      setTracks((await libraryResponse.json()).tracks);
      setLastLibrarySync(new Date().toISOString());
      setLibrarySyncFailed(false);
      const queuePayload = (await queueResponse.json()) as { jobs: QueueJob[]; mode?: "local" | "dispatch" | "unavailable"; stats?: typeof queueStats };
      setJobs(queuePayload.jobs);
      setLastQueueSync(new Date().toISOString());
      setQueueStats(queuePayload.stats ?? { medianRenderSeconds: null, sampleSize: 0 });
      if (queuePayload.mode) setRenderMode(queuePayload.mode);
      const releasesPayload = (await releasesResponse.json()) as { releases: DerivedRelease[]; mode?: "local" | "dispatch" | "unavailable" };
      setReleases(releasesPayload.releases);
      if (releasesPayload.mode) setReleaseMode(releasesPayload.mode);
    } catch { setLibrarySyncFailed(true); setToast({ message: "Could not load engine data.", error: true }); }
    finally { setLoading(false); setEverLoaded(true); }
  }, []);
  const refreshQueue = useCallback(async (showBusy = false) => {
    if (queueFetchInFlight.current || document.visibilityState !== "visible") return;
    queueFetchInFlight.current = true;
    if (showBusy) setQueueRefreshing(true);
    try {
      const response = await fetch("/api/queue", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { jobs: QueueJob[]; mode?: "local" | "dispatch" | "unavailable"; stats?: typeof queueStats };
      setJobs(payload.jobs);
      setLastQueueSync(new Date().toISOString());
      setQueueStats(payload.stats ?? { medianRenderSeconds: null, sampleSize: 0 });
      if (payload.mode) setRenderMode(payload.mode);
    } catch {
    } finally {
      queueFetchInFlight.current = false;
      if (showBusy) setQueueRefreshing(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (firstRun.shouldLaunch && variants.length > 0 && !tourActive) startTour();
  }, [firstRun.shouldLaunch, startTour, tourActive, variants.length]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("noise.library.seen") ?? "[]") as unknown;
      if (Array.isArray(saved)) setSeenLibraryIds(new Set(saved.filter((id): id is string => typeof id === "string")));
    } catch { /* ignore malformed view state */ }
  }, []);
  useEffect(() => {
    if (tab !== "library" || !tracks.length) return;
    const existing = tracks.filter((track) => track.exists).map((track) => track.variantId);
    setSeenLibraryIds((previous) => {
      const next = new Set([...previous, ...existing]);
      try { localStorage.setItem("noise.library.seen", JSON.stringify([...next])); } catch { /* ignore storage failures */ }
      return next;
    });
  }, [tab, tracks]);
  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setIntroState("hidden");
      return;
    }
    const fadeTimer = window.setTimeout(() => setIntroState("fading"), 1250);
    const hideTimer = window.setTimeout(() => setIntroState("hidden"), 1650);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);
  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);
  useEffect(() => {
    const updateTitleVisibility = () => {
      const visible = window.scrollY <= 24;
      setTabTitleVisible(visible);
      if (!visible) setTabInfoOpen(false);
    };
    updateTitleVisibility();
    window.addEventListener("scroll", updateTitleVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateTitleVisibility);
  }, []);
  useEffect(() => {
    if (!tabInfoOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTabInfoOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [tabInfoOpen]);
  useEffect(() => {
    setTabInfoOpen(false);
  }, [tab]);
  useEffect(() => {
    if (tab !== "queue" || !documentVisible || !jobs.some((job) => job.status === "Queued" || job.status === "Rendering")) return;
    const timer = window.setInterval(() => void refreshQueue(), 30000);
    return () => window.clearInterval(timer);
  }, [documentVisible, jobs, refreshQueue, tab]);
  useEffect(() => {
    if (!trackedRender || renderBanner || localStorage.getItem("noise.tutorial.render-banner") === "1") return;
    const check = async () => {
      try {
        const response = await fetch("/api/queue", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { jobs?: QueueJob[] };
        const job = payload.jobs?.find((candidate) => candidate.variantId === trackedRender.variantId);
        if (job?.status !== "Done") return;
        localStorage.setItem("noise.tutorial.render-banner", "1");
        setRenderBanner({ variantId: trackedRender.variantId });
      } catch {
        // The watcher is supplemental; the console remains usable if polling fails.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 10000);
    return () => window.clearInterval(timer);
  }, [renderBanner, trackedRender]);
  const openLibrary = useCallback((variantId?: string) => {
    libraryReturnTab.current = tab === "library" ? "queue" : tab;
    window.location.hash = variantId ? `library/${variantId}` : "library";
  }, [tab]);
  const loadLibraryFromHash = useCallback(() => {
    const match = window.location.hash.match(/^#library\/(.+)$/);
    if (!match && window.location.hash !== "#library") return;
    setTab("library");
    void refresh().then(() => {
      const variantId = match ? decodeURIComponent(match[1]) : undefined;
      window.requestAnimationFrame(() => {
        const target = variantId ? document.getElementById(`track-${variantId}`) : null;
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          target.classList.remove("track-highlight");
          void target.offsetWidth;
          target.classList.add("track-highlight");
        }
      });
    });
  }, [refresh]);
  const loadReleasesFromHash = useCallback(() => {
    const match = window.location.hash.match(/^#releases\/(.+)$/);
    if (window.location.hash !== "#releases" && !match) return;
    setTab("releases");
    setReleaseId(match ? decodeURIComponent(match[1]) : undefined);
    void refresh();
  }, [refresh]);
  const handleHashChange = useCallback(() => {
    const isLibraryHash = window.location.hash === "#library" || window.location.hash.startsWith("#library/");
    const isReleasesHash = window.location.hash === "#releases" || window.location.hash.startsWith("#releases/");
    if (isReleasesHash) {
      loadReleasesFromHash();
      return;
    }
    if (!isLibraryHash) {
      if (libraryReturnTab.current) setTab(libraryReturnTab.current);
      libraryReturnTab.current = null;
      if (window.location.hash === "") setReleaseId(undefined);
      return;
    }
    libraryReturnTab.current ??= tab === "library" ? "queue" : tab;
    loadLibraryFromHash();
  }, [loadLibraryFromHash, loadReleasesFromHash, tab]);
  useEffect(() => {
    if (window.location.hash === "#library" || window.location.hash.startsWith("#library/")) {
      libraryReturnTab.current = "design";
      loadLibraryFromHash();
    }
  }, [loadLibraryFromHash]);
  useEffect(() => {
    if (window.location.hash === "#releases" || window.location.hash.startsWith("#releases/")) loadReleasesFromHash();
  }, [loadReleasesFromHash]);
  useEffect(() => {
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [handleHashChange]);
  useEffect(() => {
    const dock = tabsRef.current;
    const moveLens = () => {
      const lens = lensRef.current;
      const active = dock?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
      if (!dock || !lens || !active) return;
      lens.style.left = `${active.offsetLeft}px`;
      lens.style.width = `${active.offsetWidth}px`;
    };
    moveLens();
    const observer = dock ? new ResizeObserver(moveLens) : null;
    if (dock && observer) observer.observe(dock);
    window.addEventListener("resize", moveLens);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", moveLens);
    };
  }, [tab]);

  async function queue(ids: string[], label: "one" | "pilot" | "full") {
    if (queueing) return;
    setQueueing(true);
    try {
      const fxBlock = label === "one" ? toFxBlock(fx) : null;
      const selector = label === "pilot" ? { pilot: true } : label === "full" ? { full: true } : { variantIds: ids, ...(fxBlock ? { fx: fxBlock } : {}) };
      const response = await fetch("/api/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selector) });
      if (!response.ok) {
        const reason = (await response.json().catch(() => ({}))) as { error?: string };
        setToast({ message: reason.error ?? "Queue request failed.", error: true });
        return;
      }
      const payload = (await response.json()) as { jobs?: QueueJob[] };
      const target = renderMode === "dispatch" ? "GitHub Actions renderer" : "worker queue";
      const colorLabel = OPTIONS.color.find(([value]) => value === selection.color)?.[1] ?? selection.color;
      setToast({
        message: label === "one"
          ? `${colorLabel} master and stems being rendered`
          : `${label === "pilot" ? "Pilot set" : `Full matrix (${variants.length} variants)`} sent to the ${target}.`,
      });
      if (ids[0]) setTrackedRender({ variantId: ids[0] });
      tour.notify("render-enqueued", undefined, { jobId: payload.jobs?.[0]?.id, variantId: ids[0] });
      await refresh();
    } finally {
      setQueueing(false);
    }
  }
  queueRef.current = queue;

  async function retry(job: QueueJob) {
    if (queueing || retryInFlight.current) return false;
    retryInFlight.current = true;
    setQueueing(true);
    try {
      const response = await fetch("/api/queue/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, variantId: job.variantId }) });
      if (!response.ok) {
        const reason = (await response.json().catch(() => ({}))) as { error?: string };
        setToast({ message: reason.error ?? "Retry failed.", error: true });
        return false;
      }
      setToast({ message: "Retry dispatched" });
      await refreshQueue();
      return true;
    } finally {
      retryInFlight.current = false;
      setQueueing(false);
    }
  }

  const queueActiveCount = jobs.filter((job) => job.status === "Rendering").length;
  const queueWaitingCount = jobs.filter((job) => job.status === "Queued").length;
  const queueSyncStatus = queueActiveCount ? queueStrings.statusCaption.rendering(queueActiveCount) : queueWaitingCount ? queueStrings.statusCaption.queued : queueStrings.statusCaption.idle;
  const queueSyncCaption = `${queueSyncStatus} · ${queueStrings.synced(lastQueueSync ? relativeTime(lastQueueSync) : "—")}`;

  return (
    <main className={`noise-shell min-h-screen w-full ${tabTitleVisible ? "" : "is-tab-title-hidden"}`} data-tutorial-ready={firstRun.ready ? "true" : "false"} style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif' }}>
      {introState !== "hidden" && <div className={`intro-splash ${introState === "fading" ? "is-fading" : ""}`} aria-hidden="true"><BellMark /><span className="intro-wordmark">Noise Labs</span></div>}
      <div className="ambient-field ambient-field-a" />
      <div className="ambient-field ambient-field-b" />
      <div className="ambient-field ambient-field-c" />
      <div className="noise-page">
        <h1 className="sr-only">Noise Lab</h1>
        {renderBanner && <Banner tone="success" className="tutorial-render-banner"><span>Your first render is done — <button type="button" onClick={() => { setRenderBanner(null); openLibrary(renderBanner.variantId); }}>hear it in the Library</button></span></Banner>}

        <div id="panel-design" role="tabpanel" aria-labelledby="tab-design" className={`panel ${tab === "design" ? "panel-show" : ""}`} hidden={tab !== "design"}>
          {initialLoad && !selected && <DesignSkeleton />}
          {selected && (
          <div className="design-stack">
            <Card as="section" padding="md" className="spectrum-card">
              <div className="spectrum-frame"><Spectrum analyser={preview.analyser} playing={preview.playing} eqGains={fx.eq.gainsDb} eqBadge={eqIsFlat(fx.eq) ? null : EQ_PRESET_LABELS[fx.eq.preset]} /></div>
              <div className="spectrum-ticks"><span>30 Hz</span><span>500</span><span>2k</span><span>16k</span></div>
            </Card>
            <div className="action-row">
              <button type="button" onClick={preview.toggle} aria-label={preview.playing ? "Stop approximate preview" : "Play approximate preview"} className="play-button">
                {preview.playing ? <Pause size={27} fill="white" strokeWidth={0} /> : <Play size={27} fill="white" strokeWidth={0} className="ml-1" />}
              </button>
              <Button variant="primary" type="button" data-tour="design-render" onClick={() => void queue([selected.variantId], "one")} disabled={queueing} title="Queues only the currently selected variant." aria-label={`Queue only the currently selected variant, variant #${selected.matrixIndex} of ${variants.length}`}>
                <Layers size={16} />
                <span>{queueing ? "Creating…" : "Create track"}</span>
              </Button>
            </div>
            <Card as="section" padding="md" className="controls-card">
              <div data-tour="design-color"><ParamRow label="Color" caption={PARAM_CAPTIONS[selection.color]}><SwatchRow options={OPTIONS.color} value={selection.color} onChange={(value) => { setSelection((old) => ({ ...old, color: value })); tour.notify("param-selected", "color"); }} label="Color" /></ParamRow></div>
              <div data-tour="design-shape">
                <ParamRow label="Band" caption={PARAM_CAPTIONS[selection.band]}><GlyphSegmented options={OPTIONS.band} value={selection.band} onChange={(value) => { setSelection((old) => ({ ...old, band: value })); tour.notify("param-selected", "shape"); }} label="Band" /></ParamRow>
                <ParamRow label="Motion" caption={PARAM_CAPTIONS[selection.motion]}><GlyphSegmented options={OPTIONS.motion} value={selection.motion} onChange={(value) => { setSelection((old) => ({ ...old, motion: value })); tour.notify("param-selected", "shape"); }} label="Motion" /></ParamRow>
                <ParamRow label="Balance" caption={PARAM_CAPTIONS[selection.balance]}><GlyphSegmented options={OPTIONS.balance} value={selection.balance} onChange={(value) => { setSelection((old) => ({ ...old, balance: value })); tour.notify("param-selected", "shape"); }} label="Balance" /></ParamRow>
              </div>
            </Card>
            <div data-tour="design-fx">
              <EqSection fx={fx} onChange={updateFx} variantId={selected.variantId} />
              <ReverbSection fx={fx} onChange={updateFx} nominalSeconds={selected.durationSeconds} variantId={selected.variantId} />
            </div>
          </div>
          )}
        </div>
        <div id="panel-library" role="tabpanel" aria-labelledby="tab-library" className={`panel ${tab === "library" ? "panel-show" : ""}`} hidden={tab !== "library"}><Library tracks={tracks} tourVariantId={trackedRender?.variantId} loading={loading} initialLoad={initialLoad} onRefresh={() => void refresh()} onToast={setToast} onTrackPlay={(variantId) => { setPlayedTrackId((current) => playedTrackIdAfterPlayback(current, variantId, "playing")); tour.notify("track-played", undefined, { variantId }); }} onTrackPlayError={(variantId) => setPlayedTrackId((current) => playedTrackIdAfterPlayback(current, variantId, "error"))} /></div>
        <div id="panel-queue" role="tabpanel" aria-labelledby="tab-queue" className={`panel ${tab === "queue" ? "panel-show" : ""}`} hidden={tab !== "queue"}><Queue jobs={jobs} tourVariantId={trackedRender?.variantId} initialLoad={initialLoad} mode={renderMode} stats={queueStats} variants={variants} tracks={tracks} onRefresh={() => void refreshQueue(true)} refreshing={queueRefreshing} onRetry={retry} onDone={(job) => void openLibrary(knownVariantId(job.variantId, variants) ?? undefined)} onToast={setToast} queueing={queueing} pilotCount={pilotCount} matrixCount={variants.length} /></div>
        <div id="panel-releases" role="tabpanel" aria-labelledby="tab-releases" className={`panel ${tab === "releases" ? "panel-show" : ""}`} hidden={tab !== "releases"}><Releases releases={releases} releaseId={releaseId} variants={variants} tracks={tracks} mode={releaseMode} initialLoad={initialLoad} onRefresh={() => void refresh()} onToast={setToast} /></div>
      </div>
      <div className={`current-tab-title ${tabTitleVisible ? "" : "is-hidden"}`} aria-hidden={tabTitleVisible ? undefined : true}>
        <span key={tab} className="current-tab-title-text">{tab === "queue" ? "Queue" : tab[0].toUpperCase() + tab.slice(1)}</span>
        {tab === "queue" && <span className="queue-sync-caption" aria-live="polite"><span className={`queue-sync-dot ${queueActiveCount ? "is-active" : ""}`} /><span className="queue-sync-text">{queueSyncCaption}</span></span>}
        {tab === "library" && <HeaderSyncCaption lastSync={lastLibrarySync} syncFailed={librarySyncFailed} loading={loading} onRefresh={() => void refresh()} hidden={!tabTitleVisible} />}
        <button type="button" className="info-button current-tab-title-info" tabIndex={tabTitleVisible ? 0 : -1} aria-label={tab === "queue" ? "How rendering works" : `How to use ${tab[0].toUpperCase() + tab.slice(1)}`} aria-expanded={tabInfoOpen} aria-controls="current-tab-tooltip" onClick={() => setTabInfoOpen((open) => !open)}><Info size={16} /></button>
        {tabInfoOpen && <div id="current-tab-tooltip" role="note" className="current-tab-tooltip">
          <div>{({
            design: "Dial in a variant, audition it, and queue the render.",
            queue: <><strong>How rendering works</strong><br />{queueStrings.queueNote[renderMode]}</>,
            library: "Browse rendered masters and their QA evidence.",
            releases: "Assemble and ship releases from your rendered masters.",
          })[tab]}</div>
          <button type="button" className="tooltip-replay" onClick={() => { setTabInfoOpen(false); tour.start({ replay: true }); }}>Replay tutorial</button>
          {authConfigured && <button type="button" className="tooltip-sign-out" onClick={() => void signOut({ callbackUrl: "/signin" })}>Sign out</button>}
        </div>}
      </div>
      <div className="dock"><nav ref={tabsRef} className="glassbar" role="tablist" aria-label="Primary">
        <div ref={lensRef} className="tab-lens" aria-hidden="true" />
        {(["design", "queue", "library", "releases"] as const).map((item) => {
          const count = item === "queue" ? queueCount : item === "library" ? libraryCount : item === "releases" ? releaseCount : 0;
          const label = item === "queue" ? "Queue" : item[0].toUpperCase() + item.slice(1);
          const Icon = TAB_ICONS[item];
          return <button key={item} id={`tab-${item}`} type="button" data-tab={item} data-tour={item === "queue" ? "dock-queue" : item === "library" ? "dock-library" : undefined} role="tab" aria-controls={`panel-${item}`} aria-selected={tab === item} aria-label={`${label}${count ? `, ${count}` : ""}`} title={label} onClick={() => {
            if (item === "library") {
              libraryReturnTab.current = tab === "library" ? "queue" : tab;
              window.location.hash = "library";
            } else if (item === "releases") {
              setReleaseId(undefined);
              window.location.hash = "releases";
            } else if (window.location.hash === "#library" || window.location.hash.startsWith("#library/") || window.location.hash === "#releases" || window.location.hash.startsWith("#releases/")) {
              libraryReturnTab.current = item;
              window.location.hash = "";
            } else {
              libraryReturnTab.current = null;
              setTab(item);
            }
            if (item === "queue" || item === "library") tour.notify("tab-changed", item);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }} className={`dock-tab ${tab === item ? "is-active" : ""}`}><span className="dock-tab-icon" aria-hidden="true"><Icon size={22} strokeWidth={2.1} />{count > 0 && <span className={`count-badge ${item === "library" ? "dim" : ""}`}>{count}</span>}</span></button>;
        })}
      </nav></div>
      {toast && <Toast message={toast.message} error={toast.error} action={toast.action} onClose={() => setToast(null)} />}
      {tour.overlay}
    </main>
  );
}

function HeaderSyncCaption({ lastSync, syncFailed, loading, onRefresh, hidden }: { lastSync: string | null; syncFailed: boolean; loading: boolean; onRefresh: () => void; hidden: boolean }) {
  const [, setSyncTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSyncTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const caption = syncFailed ? "Sync failed — retry" : loading ? "Syncing…" : lastSync ? `Synced ${relativeTime(lastSync)}` : "Syncing…";
  if (syncFailed) return <button type="button" className="header-sync-caption is-failed" tabIndex={hidden ? -1 : 0} onClick={onRefresh} disabled={loading}>{caption}</button>;
  return <span className="header-sync-caption" aria-live="polite">{caption}</span>;
}

function Library({ tracks, tourVariantId, loading, initialLoad, onRefresh, onToast, onTrackPlay, onTrackPlayError }: { tracks: LibraryTrack[]; tourVariantId?: string; loading: boolean; initialLoad: boolean; onRefresh: () => void; onToast: (toast: { message: string; error?: boolean }) => void; onTrackPlay: (variantId: string) => void; onTrackPlayError: (variantId: string) => void }) {
  const [view, setView] = useState<"cards" | "rows">("cards");
  const { pullDistance, refreshShellRef } = usePullRefresh(loading, onRefresh);
  useEffect(() => {
    if (localStorage.getItem("noise.library.view") === "rows") setView("rows");
  }, []);
  const toggleView = () => setView((current) => {
    const next = current === "cards" ? "rows" : "cards";
    try { localStorage.setItem("noise.library.view", next); } catch { /* ignore storage failures */ }
    return next;
  });
  if (initialLoad) {
    return (
      <section className="panel-section">
        <LibrarySkeleton compact={view === "rows"} />
      </section>
    );
  }
  const tourTrackId = tourVariantId && tracks.some((track) => track.exists && track.variantId === tourVariantId)
    ? tourVariantId
    : tracks.find((track) => track.exists)?.variantId;
  return (
    <section ref={refreshShellRef} className="panel-section library-refresh-shell">
      {pullDistance > 0 && <div className={`pull-refresh-indicator ${pullDistance >= 56 ? "is-ready" : ""}`} aria-live="polite" style={{ height: pullDistance }}>{pullDistance >= 56 ? "Release to refresh" : "Pull to refresh"}</div>}
      <div className="library-toolbar"><div className="section-title">Masters · {tracks.filter((track) => track.exists).length}</div><button type="button" className="icon-action view-toggle" aria-label={view === "cards" ? "Switch to compact rows" : "Switch to expanded cards"} title={view === "cards" ? "Compact rows" : "Expanded cards"} onClick={toggleView}>{view === "cards" ? <List size={18} /> : <LayoutGrid size={18} />}</button></div>
      <div className="library-list">
        {tracks.filter((track) => track.exists).length === 0 && <Card padding="md"><EmptyState title="No rendered files found." /></Card>}
        {tracks.filter((track) => track.exists).map((track) => <TrackCard key={track.variantId} track={track} compact={view === "rows"} onRefresh={onRefresh} onToast={onToast} onTrackPlay={onTrackPlay} onTrackPlayError={onTrackPlayError} dataTour={track.variantId === tourTrackId ? "library-track" : undefined} />)}
      </div>
    </section>
  );
}

function TrackCard({ track, compact = false, onRefresh, onToast, onTrackPlay, onTrackPlayError, dataTour }: { track: LibraryTrack; compact?: boolean; onRefresh: () => void; onToast: (toast: { message: string; error?: boolean }) => void; onTrackPlay: (variantId: string) => void; onTrackPlayError: (variantId: string) => void; dataTour?: string }) {
  const [suggestion, setSuggestion] = useState<{ title: string; description: string; prompt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [candidate, setCandidate] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [optimisticTitle, setOptimisticTitle] = useState(track.title ?? formatDisplayName(track));
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(track.durationSeconds);
  const [qaOpen, setQaOpen] = useState(false);
  const [menu, setMenu] = useState<"overflow" | "download" | null>(null);
  const [demoBadgeVisible, setDemoBadgeVisible] = useState(track.demo === true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleSaveInFlightRef = useRef(false);
  const titleEditCancelledRef = useRef(false);
  const qaId = `qa-${track.variantId}`;
  const title = optimisticTitle;
  useEffect(() => {
    const nextTitle = track.title ?? formatDisplayName(track);
    setOptimisticTitle(nextTitle);
    setTitleDraft(nextTitle);
  }, [track]);
  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest(".track-menu-wrap, .download-menu-wrap")) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  async function generate() {
    setBusy(true);
    const response = await fetch("/api/names/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: track.variantId, candidate }) });
    const payload = await response.json();
    setSuggestion(payload.suggestion);
    setBusy(false);
  }
  async function generateTitle() {
    if (busy) return;
    const nextCandidate = candidate;
    setCandidate((current) => current + 1);
    setBusy(true);
    try {
      const response = await fetch("/api/names/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: track.variantId, candidate: nextCandidate }) });
      const payload = await response.json() as { suggestion?: { title?: unknown } };
      if (!response.ok || typeof payload.suggestion?.title !== "string") throw new Error("Could not generate track name.");
      setTitleDraft(payload.suggestion.title);
      setEditingTitle(true);
    } catch (error) {
      onToast({ message: error instanceof Error ? error.message : "Could not generate track name.", error: true });
    } finally {
      setBusy(false);
    }
  }
  async function regenerate() {
    if (busy) return;
    setCandidate((current) => current + 1);
    setBusy(true);
    const response = await fetch("/api/names/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: track.variantId, candidate: candidate + 1 }) });
    const payload = await response.json();
    setSuggestion(payload.suggestion);
    setBusy(false);
  }
  async function approve() {
    if (!suggestion || busy) return;
    setBusy(true);
    const response = await fetch("/api/names/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: track.filename, title: suggestion.title, description: suggestion.description }) });
    setBusy(false);
    onToast(response.ok ? { message: "Name approved in sidecar metadata." } : { message: "Could not approve name.", error: true });
  }
  function cancelTitleEdit() {
    titleEditCancelledRef.current = true;
    setTitleDraft(title);
    setEditingTitle(false);
  }
  async function saveTitle() {
    if (titleEditCancelledRef.current) {
      titleEditCancelledRef.current = false;
      return;
    }
    if (!editingTitle || busy || titleSaveInFlightRef.current) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      onToast({ message: "Track title cannot be empty.", error: true });
      return;
    }
    titleSaveInFlightRef.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/names/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: track.filename, title: nextTitle }) });
      if (!response.ok) throw new Error("Could not rename track.");
      setOptimisticTitle(nextTitle);
      setEditingTitle(false);
      onToast({ message: response.status === 202 ? "Rename queued — the new title lands after the publish run." : "Track renamed." });
      onRefresh();
    } catch (error) {
      onToast({ message: error instanceof Error ? error.message : "Could not rename track.", error: true });
    } finally {
      titleSaveInFlightRef.current = false;
      setBusy(false);
    }
  }
  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play(); else audio.pause();
  };
  const download = (url = track.downloadUrl, filename = track.filename) => {
    setDownloadBusy(true);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setMenu(null);
    window.setTimeout(() => setDownloadBusy(false), 900);
  };
  const seek = (value: number) => { if (audioRef.current) audioRef.current.currentTime = value; setElapsed(value); };
  const copyUrl = async () => {
    await navigator.clipboard?.writeText(track.path);
    onToast({ message: "Master URL copied." });
    setMenu(null);
  };
  const metricClass = track.qaVerdict === "PASS" ? "qa-strip qa-pass" : track.qaVerdict === "FAIL" ? "qa-strip qa-fail" : "qa-strip";
  const audioElement = <audio ref={audioRef} preload="none" src={track.audioUrl} onPlaying={() => { setPlaying(true); onTrackPlay(track.variantId); }} onPause={() => setPlaying(false)} onError={() => { setPlaying(false); onTrackPlayError(track.variantId); }} onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : track.durationSeconds)} />;
  if (compact) {
    return (
      <Card as="article" id={`track-${track.variantId}`} padding="md" className="track-row" data-tour={dataTour}>
        {audioElement}
        <button type="button" className="player-play track-row-play" aria-label={playing ? "Pause track" : "Play track"} onClick={togglePlay}>{playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}</button>
        <div className="track-row-body">
          <div className="track-row-title" title={title}>{title}{track.demo && demoBadgeVisible && <button type="button" className="chip chip-neutral demo-chip" onClick={() => setDemoBadgeVisible(false)}>Demo ×</button>}</div>
          <div className="track-row-meta">{track.renderedAt && <><time title={absoluteTime(track.renderedAt)}>{formatCreatedDate(track.renderedAt)}</time> · </>}{formatDuration(duration)} · <span className={track.qaVerdict === "FAIL" ? "qa-fail-text" : undefined}>{track.qaVerdict}</span></div>
        </div>
        <button type="button" className="icon-action track-row-download" aria-label={`Download ${title}`} disabled={downloadBusy} onClick={() => download()}><Download size={17} /></button>
      </Card>
    );
  }
  return (
    <Card as="article" id={`track-${track.variantId}`} padding="md" className="track-card" data-tour={dataTour}>
      <div className="track-card-heading"><div className="track-card-title-wrap">{editingTitle ? <input ref={titleInputRef} className="track-card-title track-card-title-input" value={titleDraft} aria-label={`Rename ${title}`} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => void saveTitle()} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveTitle(); } else if (event.key === "Escape") { event.preventDefault(); cancelTitleEdit(); } }} /> : <button type="button" className="track-card-title" title={`Rename ${title}`} onClick={() => { titleEditCancelledRef.current = false; setTitleDraft(title); setEditingTitle(true); }}>{title}{track.titleApproved && <span className="approved-marker">approved</span>}</button>}<button type="button" className="icon-action track-name-action" aria-label="Generate track name" title="Generate track name" onMouseDown={(event) => event.preventDefault()} onClick={() => void generateTitle()} disabled={busy}><Sparkles size={15} /></button></div><div className="track-menu-wrap"><button type="button" className="icon-action" aria-label="More track actions" aria-haspopup="menu" aria-expanded={menu === "overflow"} onClick={() => setMenu(menu === "overflow" ? null : "overflow")}><MoreHorizontal size={19} /></button>{menu === "overflow" && <div className="track-menu" role="menu"><button type="button" role="menuitem" onClick={togglePlay}>{playing ? "Pause" : "Play"}</button><button type="button" role="menuitem" onClick={() => { setMenu(null); void generate(); }}><Sparkles size={14} /> Suggest SEO name</button><button type="button" role="menuitem" onClick={() => { setQaOpen(true); setMenu(null); document.getElementById(qaId)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>View QA report</button><button type="button" role="menuitem" onClick={() => void copyUrl()}>Copy file URL <span className="developer-label">(developer)</span></button></div>}</div></div>
      <div className="track-chips"><Chip>{track.demo && demoBadgeVisible ? <button type="button" className="demo-chip" onClick={() => setDemoBadgeVisible(false)}>Demo ×</button> : `Matrix ${track.matrixIndex}`}</Chip><Chip>{track.color}</Chip><Chip>{track.band}</Chip><Chip>{track.motion}</Chip></div>
      {track.renderedAt && <div className="track-date">Created <time title={absoluteTime(track.renderedAt)}>{formatCreatedDate(track.renderedAt)}</time></div>}
      <div className="custom-player">{audioElement}<button type="button" className="player-play" aria-label={playing ? "Pause track" : "Play track"} onClick={togglePlay}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><span className="player-time">{formatDuration(elapsed)}</span><input className="player-scrubber" type="range" min={0} max={duration} step={0.1} value={Math.min(elapsed, duration)} aria-label="Seek track" onChange={(event) => seek(Number(event.target.value))} /><span className="player-time">{formatDuration(duration)}</span></div>
      <Disclosure open={qaOpen} onOpenChange={setQaOpen} className={metricClass} triggerClassName="qa-header" triggerId={qaId} contentId={`${qaId}-checks`} summary={<><span><span className="qa-metric-label">LUFS</span><strong>{track.measuredLufs ?? "—"}</strong></span><span><span className="qa-metric-label">True peak</span><strong>{track.measuredTruePeak ?? "—"}</strong></span><span className="qa-verdict">{track.qaVerdict}</span>{qaOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</>}>
        <div className="qa-checks">{track.qaChecks.length ? track.qaChecks.map((check) => <span key={check.name}><span>{check.passed ? "✓" : "×"} {check.name}</span><b>{check.measured}</b></span>) : "No QA checks available."}</div>
      </Disclosure>
      <div className="download-menu-wrap"><div className="download-split"><Button variant="neutral" type="button" onClick={() => download()} disabled={downloadBusy} className="download-main"><Download size={15} /> {downloadBusy ? "Preparing…" : "Download"}</Button><button type="button" className="download-chevron" aria-label="Download options" aria-haspopup="menu" aria-expanded={menu === "download"} onClick={() => setMenu(menu === "download" ? null : "download")}><ChevronDown size={15} /></button></div>{menu === "download" && <div className="track-menu download-menu" role="menu"><button type="button" role="menuitem" onClick={() => download()}><span>Master</span><small>{formatBytes(track.sizeBytes)}</small></button>{track.stems.filter((stem) => stem.exists).map((stem) => <button type="button" role="menuitem" key={stem.filename} onClick={() => download(stem.downloadUrl, stem.filename)}><span>Stem {stem.number} — {stem.stem}</span><small>{formatBytes(stem.sizeBytes)}</small></button>)}<div className="menu-separator" /><button type="button" role="menuitem" onClick={() => download(`/api/bundle/${encodeURIComponent(track.variantId)}`, `${track.variantId}.zip`)}><span>All as .zip</span><small>{formatBytes(track.sizeBytes + track.stems.filter((stem) => stem.exists).reduce((total, stem) => total + stem.sizeBytes, 0))}</small></button></div>}</div>
        {suggestion && <div className="mt-3 rounded-xl border border-[color:var(--separator)] p-3"><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ink-secondary)]">Review before approval</div><input value={suggestion.title} onChange={(event) => setSuggestion({ ...suggestion, title: event.target.value })} className="w-full border-b border-[color:var(--separator)] pb-1 text-sm font-semibold outline-none" /><textarea value={suggestion.description} onChange={(event) => setSuggestion({ ...suggestion, description: event.target.value })} className="mt-2 h-16 w-full resize-none text-xs leading-4 outline-none" /><div className="mt-2 flex justify-end gap-2"><Button variant="link" type="button" onClick={() => void regenerate()} disabled={busy}>Regenerate</Button><Button variant="primary" type="button" onClick={() => void approve()} disabled={busy}>{busy ? "Approving…" : "Approve"}</Button></div></div>}
    </Card>
  );
}

function Releases({ releases, releaseId, variants, tracks, mode, initialLoad, onRefresh, onToast }: {
  releases: DerivedRelease[];
  releaseId?: string;
  variants: Variant[];
  tracks: LibraryTrack[];
  mode: "local" | "dispatch" | "unavailable";
  initialLoad: boolean;
  onRefresh: () => void;
  onToast: (toast: { message: string; error?: boolean }) => void;
}) {
  const release = releases.find((candidate) => candidate.id === releaseId);
  const content = !releaseId || !release
    ? <ReleaseList releases={releases} initialLoad={initialLoad} />
    : <ReleaseDetail release={release} savedArtist={releases.find((candidate) => !candidate.unsaved)?.artist} variants={variants} tracks={tracks} mode={mode} onRefresh={onRefresh} onToast={onToast} />;
  return (
    <>
      <Banner tone="warning">
        <AlertCircle size={18} aria-hidden="true" />
        <div><strong>Work in progress — do not use</strong><span>The Releases workflow is not ready for production.</span></div>
      </Banner>
      {content}
    </>
  );
}

function ReleaseList({ releases, initialLoad }: { releases: DerivedRelease[]; initialLoad: boolean }) {
  return (
    <section className="panel-section">
      {initialLoad && <ReleasesSkeleton />}
      <div className="release-list">
        {!initialLoad && releases.length === 0 && <Card padding="md"><EmptyState title="No releases yet." /></Card>}
        {releases.map((release) => (
          <Card as="article" key={release.id} padding="md" className="release-card" tabIndex={0} role="button" onClick={() => { window.location.hash = `releases/${encodeURIComponent(release.id)}`; }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") window.location.hash = `releases/${encodeURIComponent(release.id)}`; }}>
            <div className="release-card-heading"><div className="min-w-0 text-left"><div className="release-kicker">{release.unsaved ? "Suggested preset" : release.type.toUpperCase()}</div><h3>{release.title}</h3><p>{release.artist} · {release.tracks.length} tracks</p></div><StatusPill state={release.state.toLowerCase() as "ready" | "submitted" | "active" | "queued" | "rendering" | "failed" | "cancelled" | "pending"}>{release.state}</StatusPill></div>
            <div className="release-checklist" aria-label={`${release.state}: ${release.blockingItem}`}><span className={release.ladder.named ? "release-stage-done" : "release-stage-pending"}>{release.ladder.named ? "✓" : "○"} Named</span><span className={release.ladder.art ? "release-stage-done" : "release-stage-pending"}>{release.ladder.art ? "✓" : "○"} Art</span><span className={release.ladder.ready ? "release-stage-done" : "release-stage-pending"}>{release.ladder.ready ? "✓" : "○"} Ready</span>{release.ladder.submitted && <span className="release-stage-done">✓ Submitted</span>}<span className="release-blocker">{release.blockingItem}</span></div>
            {release.unsaved && release.id === "pilot-ep" && <div className="release-preset-hint">Start with the pilot EP (8 tracks)</div>}
            {release.submitted.storeUrl && <a href={release.submitted.storeUrl} target="_blank" rel="noreferrer" className="release-store-link" onClick={(event) => event.stopPropagation()}>Submitted · open in store ↗</a>}
          </Card>
        ))}
      </div>
    </section>
  );
}

function ReleaseDetail({ release, savedArtist, variants, tracks, mode, onRefresh, onToast }: {
  release: DerivedRelease;
  savedArtist?: string;
  variants: Variant[];
  tracks: LibraryTrack[];
  mode: "local" | "dispatch" | "unavailable";
  onRefresh: () => void;
  onToast: (toast: { message: string; error?: boolean }) => void;
}) {
  const [draft, setDraft] = useState<Release>(release);
  const [busy, setBusy] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const artPreview = useRef<HTMLCanvasElement>(null);
  const candidateCounts = useRef(new Map<string, number>());
  const dirty = useRef(false);
  const loadedReleaseId = useRef(release.id);
  const dimensions = useMemo<CoverArtDimensions>(() => {
    const byId = new Map(variants.map((variant) => [variant.variantId, variant]));
    return draft.tracks.flatMap((track) => {
      const variant = byId.get(track.variantId);
      return variant ? [{ color: variant.color, band: variant.band, motion: variant.motion }] : [];
    });
  }, [draft.tracks, variants]);
  const lint = useMemo(() => lintNames(draft.tracks.map((track) => track.title)), [draft.tracks]);
  const variantById = useMemo(() => new Map(variants.map((variant) => [variant.variantId, variant])), [variants]);
  const libraryById = useMemo(() => new Map(tracks.map((track) => [track.variantId, track])), [tracks]);
  useEffect(() => {
    if (loadedReleaseId.current === release.id && dirty.current) return;
    const next = { ...release };
    if (release.unsaved && savedArtist) next.artist = savedArtist;
    setDraft(next);
    setHandoff(false);
    dirty.current = false;
    loadedReleaseId.current = release.id;
  }, [release, savedArtist]);

  useEffect(() => {
    if (!artPreview.current || draft.artSeed === null || !dimensions.length) return;
    const source = document.createElement("canvas");
    renderCoverArt(source, draft, dimensions, draft.artSeed, true);
    const context = artPreview.current.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, artPreview.current.width, artPreview.current.height);
    context.drawImage(source, 0, 0, artPreview.current.width, artPreview.current.height);
  }, [draft, dimensions]);

  function update(patch: Partial<Release>) {
    dirty.current = true;
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function persist(next = draft) {
    if (mode === "unavailable") {
      onToast({ message: "Releases are edited where a writer is configured; this deployment is read-only", error: true });
      return false;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/releases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toReleaseDocument(next)) });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        onToast({ message: payload.error ?? "Could not save release.", error: true });
        return false;
      }
      onToast({ message: mode === "dispatch" ? "Release save dispatched." : "Release saved." });
      dirty.current = false;
      onRefresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function generateNames() {
    if (busy || mode === "unavailable") return;
    setBusy(true);
    try {
      const nextTracks: ReleaseTrack[] = [];
      for (const track of draft.tracks) {
        const response = await fetch("/api/names/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: track.variantId, siblingTitles: nextTracks.map((candidate) => candidate.title) }) });
        if (!response.ok) throw new Error("Name generation failed");
        const payload = (await response.json()) as { suggestion: { title: string; description: string } };
        nextTracks.push({ ...track, title: payload.suggestion.title, description: payload.suggestion.description, approvedAt: null });
      }
      const next = { ...draft, tracks: nextTracks };
      setDraft(next);
      await persist(next);
    } catch (error) {
      onToast({ message: error instanceof Error ? error.message : "Name generation failed.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(index: number) {
    if (busy || mode === "unavailable") return;
    const track = draft.tracks[index];
    const candidate = (candidateCounts.current.get(track.variantId) ?? index) + 1;
    candidateCounts.current.set(track.variantId, candidate);
    const response = await fetch("/api/names/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: track.variantId, candidate, siblingTitles: draft.tracks.filter((_, row) => row !== index).map((candidate) => candidate.title) }) });
    if (!response.ok) {
      onToast({ message: "Name generation failed.", error: true });
      return;
    }
    const payload = (await response.json()) as { suggestion: { title: string; description: string } };
    const nextTracks = draft.tracks.map((candidate, row) => row === index ? { ...candidate, title: payload.suggestion.title, description: payload.suggestion.description, approvedAt: null } : candidate);
    dirty.current = true;
    setDraft({ ...draft, tracks: nextTracks });
  }

  async function approveNames() {
    if (lint.hardFailures.length) {
      onToast({ message: lint.hardFailures[0].message, error: true });
      return;
    }
    const next = { ...draft, tracks: draft.tracks.map((track) => ({ ...track, approvedAt: new Date().toISOString() })) };
    dirty.current = true;
    setDraft(next);
    await persist(next);
  }

  function regenerateArt() {
    if (mode === "unavailable") return;
    const next = { ...draft, artSeed: crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff };
    dirty.current = true;
    setDraft(next);
    void persist(next);
  }

  function downloadArt() {
    if (draft.artSeed === null || !dimensions.length) return;
    const source = document.createElement("canvas");
    renderCoverArt(source, draft, dimensions, draft.artSeed, true);
    source.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${draft.id}-cover.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }

  function copy(value: string, label: string) {
    if (!navigator.clipboard) {
      onToast({ message: `Could not copy ${label.toLowerCase()}.`, error: true });
      return;
    }
    void navigator.clipboard.writeText(value)
      .then(() => onToast({ message: `${label} copied.` }))
      .catch(() => onToast({ message: `Could not copy ${label.toLowerCase()}.`, error: true }));
  }

  async function markSubmitted(storeUrl: string) {
    const next = { ...draft, submitted: { at: new Date().toISOString(), storeUrl: storeUrl.trim() || null } };
    setDraft(next);
    await persist(next);
  }

  if (handoff && release.state === "Ready") {
    return <DistroHandoff release={draft} tracks={tracks} onBack={() => setHandoff(false)} onCopy={copy} onSubmit={markSubmitted} mode={mode} />;
  }
  const namesReady = draft.tracks.every((track) => track.title.trim()) && lint.hardFailures.length === 0;
  const footerLabel = release.state === "Submitted" ? "Submitted · open in store" : !namesReady ? "Generate names" : release.state === "Named" ? "Approve names" : release.state === "Ready" ? "Prepare for DistroKid" : "Save release";
  const footerAction = release.state === "Submitted" ? () => undefined : !namesReady ? generateNames : release.state === "Named" ? approveNames : release.state === "Ready" ? () => setHandoff(true) : () => void persist();
  return (
    <section className="panel-section release-detail">
      <button type="button" className="back-link" onClick={() => { window.location.hash = "releases"; }}><ChevronLeft size={17} /> All releases</button>
      <div className="panel-heading"><div><div className="release-kicker">{release.unsaved ? "Suggested preset" : release.type.toUpperCase()}</div><h2>{draft.title || "Untitled release"}</h2><p>{draft.tracks.length} tracks · <span aria-live="polite">{release.state} · {release.blockingItem}</span></p>{release.submitted.storeUrl && <a href={release.submitted.storeUrl} target="_blank" rel="noreferrer" className="release-store-link">Submitted · open in store ↗</a>}</div><button type="button" onClick={() => void persist()} disabled={busy || mode === "unavailable" || release.state === "Submitted"} className="round-action" aria-label="Save release"><Save size={14} /></button></div>
      {mode === "unavailable" && <Banner tone="danger" className="unavailable-note">Releases are edited where a writer is configured; this deployment is read-only.</Banner>}
      <Card as="section" padding="md" className="release-section"><div className="section-title">Metadata</div><div className="release-fields">
        {(["artist", "title", "genre", "secondaryGenre", "songwriter"] as const).map((field) => <label key={field} className="release-field"><span>{field === "secondaryGenre" ? "Secondary genre" : field[0].toUpperCase() + field.slice(1)}</span><input value={draft[field]} disabled={mode === "unavailable"} onChange={(event) => update({ [field]: event.target.value })} /></label>)}
        <label className="release-field"><span>Release date</span><input type="date" value={draft.releaseDate} disabled={mode === "unavailable"} onChange={(event) => update({ releaseDate: event.target.value })} /></label>
      </div></Card>
      <Card as="section" padding="md" className="release-section"><div className="section-title">Tracklist · {draft.tracks.length}</div>
        <ol className="tracklist" aria-label="Release tracklist">
          {draft.tracks.map((track, index) => {
            const library = libraryById.get(track.variantId);
            const variant = variantById.get(track.variantId);
            const messages = lint.messages.filter((message) => message.row === index);
            return <li className="release-track-row" aria-label={`Track ${index + 1}: ${track.title || "untitled"}`} key={track.variantId}>
              <div className="release-track-number">{index + 1}</div><div className="release-track-body"><div className="release-track-meta">{variant?.color} / {variant?.band} / {variant?.motion} {library?.exists ? "· rendered" : "· not rendered"}</div><input aria-label={`Track ${index + 1} title`} value={track.title} disabled={mode === "unavailable"} placeholder="Untitled track" onChange={(event) => { dirty.current = true; setDraft({ ...draft, tracks: draft.tracks.map((candidate, row) => row === index ? { ...candidate, title: event.target.value, approvedAt: null } : candidate) }); }} />{messages.map((message) => <div className={`lint-message lint-${message.severity}`} key={message.message}>{message.message}</div>)}</div><button type="button" className="queue-link regenerate-button" disabled={busy || mode === "unavailable"} onClick={() => void regenerate(index)} aria-label={`Regenerate title for track ${index + 1}`}><RefreshCw size={14} /></button>
            </li>;
          })}
        </ol>
        <div className="release-track-actions"><Button variant="neutral" type="button" disabled={busy || mode === "unavailable"} onClick={() => void generateNames()}><Sparkles size={14} /> Generate names</Button><Button variant="primary" type="button" disabled={busy || mode === "unavailable" || lint.hardFailures.length > 0 || !namesReady} onClick={() => void approveNames()}>Approve names</Button></div>
      </Card>
      <Card as="section" padding="md" className="release-section"><div className="section-title">Cover art</div><div className="cover-art-frame">{draft.artSeed === null ? <EmptyState title="No art yet — generate a seed below." /> : <canvas ref={artPreview} width="240" height="240" aria-label="Generated cover art preview" />}</div><div className="cover-art-actions"><Button variant="neutral" type="button" disabled={mode === "unavailable"} onClick={regenerateArt}>{draft.artSeed === null ? "Generate cover art" : "Regenerate"}</Button>{draft.artSeed !== null && <Button variant="neutral" type="button" className="cover-download" onClick={downloadArt}><Download size={14} /> Download PNG</Button>}</div></Card>
      <div className="release-footer"><div className="release-footer-status" aria-live="polite"><strong>{release.state}</strong><span>{release.blockingItem}</span></div><Button variant="primary" type="button" disabled={busy || mode === "unavailable" || (release.state === "Ready" && !namesReady)} onClick={() => void footerAction()}>{footerLabel}</Button></div>
    </section>
  );
}

function DistroHandoff({ release, tracks, onBack, onCopy, onSubmit, mode }: {
  release: Release;
  tracks: LibraryTrack[];
  onBack: () => void;
  onCopy: (value: string, label: string) => void;
  onSubmit: (storeUrl: string) => Promise<void>;
  mode: "local" | "dispatch" | "unavailable";
}) {
  const [storeUrl, setStoreUrl] = useState("");
  const byId = new Map(tracks.map((track) => [track.variantId, track]));
  return <section className="panel-section release-detail">
    <button type="button" className="back-link" onClick={onBack}><ChevronLeft size={17} /> Release checklist</button>
    <div className="panel-heading"><div><h2>Prepare for DistroKid</h2><p>Copy each field, then upload the downloaded files.</p></div></div>
    <Card as="section" padding="md" className="release-section"><div className="section-title">Release metadata</div>{[
      ["Artist", release.artist], ["Release title", release.title], ["Number of songs", String(release.tracks.length)], ["Genre", release.genre], ["Secondary genre", release.secondaryGenre], ["Release date", release.releaseDate], ["Songwriter", release.songwriter],
    ].map(([label, value]) => <div className="copy-field" key={label}><div><span>{label}</span><strong>{value || "Not set"}</strong></div><Button variant="link" type="button" disabled={!value} onClick={() => onCopy(value, label)} aria-label={`Copy ${label}`}><Clipboard size={16} /> Copy</Button></div>)}</Card>
    <Card as="section" padding="md" className="release-section"><div className="section-title">Tracklist</div>{release.tracks.map((track, index) => <div className="copy-field" key={track.variantId}><div><span>{index + 1}. Track title · Songwriter</span><strong>{track.title} · {release.songwriter || "Not set"}</strong></div><div className="copy-actions"><Button variant="link" type="button" onClick={() => onCopy(track.title, `Track ${index + 1} title`)}><Clipboard size={16} /> Copy</Button>{byId.get(track.variantId)?.exists && <Button as="a" variant="link" href={byId.get(track.variantId)?.downloadUrl} download><Download size={16} /> WAV</Button>}</div></div>)}</Card>
    <Card as="section" padding="md" className="release-section"><div className="section-title">Store answers</div><p className="handoff-note">Not explicit · Instrumental · No radio edit</p><p className="handoff-note">Masters: 96 kHz/24-bit WAV · stems: 48 kHz/24-bit WAV · −20 LUFS / −3 dBTP</p></Card>
    <Card as="section" padding="md" className="release-section"><div className="section-title">Mark submitted</div><label className="release-field"><span>DistroKid or Spotify URL (optional)</span><input value={storeUrl} onChange={(event) => setStoreUrl(event.target.value)} placeholder="https://" /></label><Button variant="primary" type="button" className="handoff-submit" disabled={mode === "unavailable"} onClick={() => void onSubmit(storeUrl)}>Mark submitted</Button></Card>
  </section>;
}

function Queue({ jobs, tourVariantId, initialLoad, mode, stats, variants, tracks, onRefresh, refreshing, onRetry, onDone, onToast, queueing, pilotCount, matrixCount }: { jobs: QueueJob[]; tourVariantId?: string; initialLoad: boolean; mode: "local" | "dispatch" | "unavailable"; stats: { medianRenderSeconds: number | null; sampleSize: number }; variants: Variant[]; tracks: LibraryTrack[]; onRefresh: () => void; refreshing: boolean; onRetry: (job: QueueJob) => Promise<boolean>; onDone: (job: QueueJob) => void; onToast: (toast: ToastState) => void; queueing: boolean; pilotCount: number; matrixCount: number }) {
  const [, setSyncTick] = useState(0);
  const { pullDistance, refreshShellRef } = usePullRefresh(refreshing, onRefresh);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [openDisclosure, setOpenDisclosure] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<RenderJob | null>(null);
  const [retried, setRetried] = useState<Set<string>>(new Set());
  const [archive, setArchive] = useState<DismissalRecord[]>([]);
  const pilotMembers = variants.filter((variant) => variant.pilot !== null).map((variant) => variant.variantId);
  const fullMembers = variants.map((variant) => variant.variantId);
  const partition = partitionRenderJobs(jobs, pilotMembers, fullMembers);
  useEffect(() => { const timer = window.setInterval(() => setSyncTick((tick) => tick + 1), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/queue/dismiss", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { records?: DismissalRecord[] };
        if (!cancelled && payload.records) setArchive(payload.records);
      } catch { /* the archive is supplemental; the queue itself remains usable */ }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest(".queue-menu-wrap")) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); setConfirmRemove(null); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const archivedIds = new Set(archive.map((record) => record.job.id));
  const visible = (items: RenderJob[]) => items.filter((item) => !archivedIds.has(item.latest.id));
  const attention = visible(partition.needsAttention);
  const active = visible(partition.active);
  const completed = visible(partition.completed);
  const history = visible(partition.history);
  const nameFor = (id: string) => formatQueueDisplayName(id, variants, { pilot: pilotCount, full: matrixCount });
  const chipsFor = (id: string) => { const variant = variants.find((candidate) => candidate.variantId === id); return variant ? [`Matrix ${variant.matrixIndex}`, variant.color, variant.band, variant.motion] : []; };
  const activeCopy = (job: RenderJob) => {
    if (mode === "local") return job.latest.status === "Queued" ? `${queuedJobsAhead(job.latest.id, jobs)} jobs ahead` : queueStrings.rendering;
    const elapsed = job.latest.startedAt ? (Date.now() - new Date(job.latest.startedAt).getTime()) / 1000 : 0;
    return job.latest.status === "Rendering" ? `${renderEstimate(stats.medianRenderSeconds, stats.sampleSize, elapsed)} left` : stats.sampleSize ? `Typically ${renderEstimate(stats.medianRenderSeconds, stats.sampleSize)} once started` : renderEstimate(null, 0);
  };
  const hasArtifacts = (job: RenderJob) => {
    const ids = batchMembersForJob(job.latest, pilotMembers, fullMembers) ?? [job.latest.variantId];
    return ids.some((id) => tracks.some((track) => track.variantId === id && track.exists));
  };
  let queueTourTargetAssigned = false;
  const remove = async (job: RenderJob) => {
    setConfirmRemove(null); setMenu(null);
    try {
      const response = await fetch("/api/queue/dismiss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: job.latest }) });
      const payload = (await response.json().catch(() => ({}))) as { records?: DismissalRecord[]; error?: string };
      if (!response.ok || !payload.records) { onToast({ message: payload.error ?? queueStrings.dismiss.failed, error: true }); return; }
      setArchive(payload.records);
      onToast({ message: queueStrings.dismiss.removed });
    } catch { onToast({ message: queueStrings.dismiss.failed, error: true }); }
  };
  const retry = async (job: RenderJob) => {
    if (confirm !== job.latest.id) { setConfirm(job.latest.id); window.setTimeout(() => setConfirm((current) => current === job.latest.id ? null : current), 3000); return; }
    if (await onRetry(job.latest)) { setRetried((old) => new Set(old).add(job.latest.id)); setConfirm(null); }
  };
  const card = (job: RenderJob) => {
    const latest = job.latest;
    const tourTarget = tourVariantId ? latest.variantId === tourVariantId : !queueTourTargetAssigned;
    if (tourTarget) queueTourTargetAssigned = true;
    const failed = latest.status === "Failed" || latest.status === "Cancelled"; const done = latest.status === "Done"; const activeItem = latest.status === "Queued" || latest.status === "Rendering";
    const name = nameFor(latest.variantId); const failure = latest.failure?.step ? queueStrings.failedAt(latest.failure.step, latest.failure.exitCode) : latest.error ?? queueStrings.failure(name, latest.status); const displayTime = latest.finishedAt ?? latest.queuedAt;
    return <Card as="article" padding="md" key={job.variantId} data-tour={tourTarget ? "queue-job" : undefined}>
      <div className="queue-title-row"><div className="queue-name" title={name === "Unknown variant" ? latest.variantId : undefined}>{name}</div>{done ? <StatusPill state="ready">{queueStrings.status.done}</StatusPill> : failed && <div className="track-menu-wrap queue-menu-wrap"><button type="button" className="icon-action queue-overflow" aria-label="More queue actions" aria-haspopup="menu" aria-expanded={menu === latest.id} onClick={() => setMenu(menu === latest.id ? null : latest.id)}><MoreHorizontal size={19} /></button>{menu === latest.id && <div className="track-menu" role="menu">{latest.logsUrl && <a href={latest.logsUrl} target="_blank" rel="noopener" role="menuitem">{queueStrings.logs}</a>}<button type="button" role="menuitem" onClick={() => hasArtifacts(job) ? setConfirmRemove(job) : void remove(job)}>Remove from history</button></div>}</div>}</div>
      <div className="queue-chips">{failed && <StatusPill state="failed">{queueStrings.status.failed}</StatusPill>}{activeItem && <StatusPill state="active">{latest.status === "Rendering" ? queueStrings.status.rendering : queueStrings.status.queued}</StatusPill>}{chipsFor(latest.variantId).map((chip) => <Chip key={chip}>{chip}</Chip>)}{fxBadges(latest.fx).map((badge) => <Chip key={badge}>{badge}</Chip>)}</div>
      {activeItem && <div className="queue-active-copy">{activeCopy(job)}</div>}
      {failed && <Disclosure open={openDisclosure === `${latest.id}-failure`} onOpenChange={(open) => setOpenDisclosure(open ? `${latest.id}-failure` : null)} className="queue-detail-strip queue-failure-strip" summary={<>{failure}<ChevronDown size={15} /></>}>
        <Banner tone="danger" className="queue-failure-content"><div className="queue-diagnostics"><div>Failed step · {latest.failure?.step ?? "Unavailable"}</div><div>Exit code · {latest.failure?.exitCode ?? "—"}</div><div>Duration · {latest.failure?.durationSeconds ? formatQueueDuration(latest.failure.durationSeconds) : latest.durationSeconds ? formatQueueDuration(latest.durationSeconds) : "—"}</div><div>Runner · {latest.failure?.runner ?? (mode === "local" ? "Local worker" : "—")}</div>{latest.logsUrl && <a href={latest.logsUrl} target="_blank" rel="noopener">{queueStrings.logs} →</a>}</div></Banner>
      </Disclosure>}
      {job.attempts.length > 1 && <Disclosure open={openDisclosure === `${latest.id}-history`} onOpenChange={(open) => setOpenDisclosure(open ? `${latest.id}-history` : null)} className="queue-detail-strip queue-history-strip" summary={<>{queueStrings.runHistory(job.attempts.length)}<ChevronDown size={15} /></>}>
        <div className="queue-diagnostics">{job.attempts.map((attempt, index) => <div key={attempt.id}><span>{queueStrings.attempt(index + 1, relativeTime(attempt.queuedAt))}</span> <span className={attempt.status === "Done" ? "duration-good" : "duration-bad"}>{attempt.status === "Done" ? "✓" : "✗"} {attempt.durationSeconds ? formatQueueDuration(attempt.durationSeconds) : "—"}</span></div>)}</div>
      </Disclosure>}
      <div className="queue-meta"><time title={absoluteTime(displayTime)}>{relativeTime(displayTime)}</time>{failed && ` · ${job.attempts.length} attempts`}</div>
      <div className="queue-card-actions">{done ? <Button variant="neutral" type="button" onClick={() => onDone(latest)}>{queueStrings.library}</Button> : failed && <><Button variant="neutral" type="button" className={retried.has(latest.id) ? "queue-retry-confirmed" : ""} disabled={queueing || retried.has(latest.id)} onClick={() => void retry(job)}>{retried.has(latest.id) ? "Queued ✓" : confirm === latest.id ? `Dispatch Actions run (${stats.sampleSize ? renderEstimate(stats.medianRenderSeconds, stats.sampleSize) : "~6 min"})?` : "Re-run render"}</Button><Button variant="neutral" type="button" onClick={() => hasArtifacts(job) ? setConfirmRemove(job) : void remove(job)}>Remove</Button></>}</div>
    </Card>;
  };
  const archivedCard = (record: DismissalRecord) => {
    const job = record.job;
    const name = nameFor(job.variantId);
    const failure = job.failure?.step ? queueStrings.failedAt(job.failure.step, job.failure.exitCode) : job.error ?? queueStrings.failure(name, job.status);
    return <Card as="article" padding="md" key={job.id}>
      <div className="queue-title-row"><div className="queue-name" title={name === "Unknown variant" ? job.variantId : undefined}>{name}</div></div>
      <div className="queue-chips"><StatusPill state={job.status === "Cancelled" ? "cancelled" : "failed"}>{job.status === "Cancelled" ? queueStrings.status.cancelled : queueStrings.status.failed}</StatusPill>{chipsFor(job.variantId).map((chip) => <Chip key={chip}>{chip}</Chip>)}</div>
      <Disclosure open={openDisclosure === `${job.id}-failure`} onOpenChange={(open) => setOpenDisclosure(open ? `${job.id}-failure` : null)} className="queue-detail-strip queue-failure-strip" summary={<>{failure}<ChevronDown size={15} /></>}>
        <Banner tone="danger" className="queue-failure-content"><div className="queue-diagnostics"><div>Failed step · {job.failure?.step ?? "Unavailable"}</div><div>Exit code · {job.failure?.exitCode ?? "—"}</div><div>Duration · {job.failure?.durationSeconds ? formatQueueDuration(job.failure.durationSeconds) : job.durationSeconds ? formatQueueDuration(job.durationSeconds) : "—"}</div><div>Runner · {job.failure?.runner ?? (mode === "local" ? "Local worker" : "—")}</div>{job.logsUrl && <a href={job.logsUrl} target="_blank" rel="noopener">{queueStrings.logs} →</a>}</div></Banner>
      </Disclosure>
      <div className="queue-meta"><time title={absoluteTime(record.dismissedAt)}>{queueStrings.archivedAt(relativeTime(record.dismissedAt))}</time>{record.r2Cleanup && ` · ${queueStrings.r2Cleanup[record.r2Cleanup.state]}`}</div>
    </Card>;
  };
  const section = (label: string, items: RenderJob[]) => items.length ? <section className="queue-group queue-section" key={label}><div className="section-title">{label} · {items.length}</div><div className="queue-job-list">{items.map(card)}</div></section> : null;
  const buckets = groupCompletedByDay(completed);
  return <section ref={refreshShellRef} className="panel-section queue-refresh-shell queue-section">{pullDistance > 0 && <div className={`pull-refresh-indicator ${pullDistance >= 56 ? "is-ready" : ""}`} style={{ height: pullDistance }}>{pullDistance >= 56 ? "Release to refresh" : "Pull to refresh"}</div>}{initialLoad ? <QueueSkeleton /> : <>{section(queueStrings.sections.attention, attention)}{section(queueStrings.sections.active, active)}{buckets.map((bucket) => section(bucket.label, bucket.jobs))}{history.length > 0 && <Disclosure open={openDisclosure === "history"} onOpenChange={(open) => setOpenDisclosure(open ? "history" : null)} className="queue-history" summary={queueStrings.historyCount(history.length)}><div className="queue-job-list">{history.map(card)}</div></Disclosure>}{archive.length > 0 && <Disclosure open={openDisclosure === "archive"} onOpenChange={(open) => setOpenDisclosure(open ? "archive" : null)} className="queue-history" summary={queueStrings.archivedCount(archive.length)}><div className="queue-job-list">{archive.map(archivedCard)}</div></Disclosure>}</>}{confirmRemove && <div className="queue-confirm-backdrop" role="presentation" onClick={() => setConfirmRemove(null)}><div className="queue-confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="queue-remove-title" onClick={(event) => event.stopPropagation()}><h2 id="queue-remove-title">Remove from history?</h2><p>This archives the queue entry — it stays reviewable under Archived below — and queues deletion of its published output from R2.</p><div className="queue-card-actions"><Button variant="neutral" type="button" onClick={() => setConfirmRemove(null)}>Cancel</Button><Button variant="primary" type="button" onClick={() => void remove(confirmRemove)}>Remove history entry</Button></div></div></div>}</section>;
}
