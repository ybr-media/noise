"use client";

import {
  AlertCircle,
  Check,
  Clipboard,
  Download,
  Grid3x3,
  Info,
  Layers,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Save,
  ChevronLeft,
  LibraryBig,
  Rocket,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryTrack, QueueJob, Release, ReleaseTrack, Variant } from "@/lib/types";
import { absoluteTime, batchMembersForJob, batchMissingMastersSummary, knownVariantId, queueAheadLabel, queuedJobsAhead, relativeTime, renderEstimate } from "@/lib/eta";
import { groupCompletedByDay, partitionRenderJobs, type RenderJob } from "@/lib/render-jobs";
import { formatBatchLabel, formatVariantLabel, isBatchVariantId, OPTIONS } from "@/lib/variant-labels";
import type { DerivedRelease } from "@/lib/releases";
import { toReleaseDocument } from "@/lib/release-document";
import { mulberry32, renderCoverArt, type CoverArtDimensions } from "@/lib/cover-art";
import { lintNames } from "@/lib/name-lint";
import { BellMark } from "./bell-mark";

const TAB_ICONS = {
  design: SlidersHorizontal,
  queue: Layers,
  library: LibraryBig,
  releases: Rocket,
} as const;

const C = {
  page: "#F2F2F7",
  card: "#FFFFFF",
  label: "#1C1C1E",
  secondary: "#8E8E93",
  separator: "#D8D8DC",
  track: "#E9E9EB",
  accent: "#FF3B30",
  green: "#34C759",
  orange: "#FF9500",
  blue: "#007AFF",
};

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

function GlyphSegmented({ options, value, onChange, label }: {
  options: readonly (readonly [string, string])[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="glyph-segmented" role="radiogroup" aria-label={label} onKeyDown={radioArrowHandler(options, value, onChange)}>
      {options.map(([id, name]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} tabIndex={value === id ? 0 : -1} data-option={id}
          aria-label={PARAM_ARIA_LABELS[id] ?? name}
          onClick={() => { if (value !== id) fireSelectionHaptic(); onChange(id); }}
          className={`glyph-segment ${value === id ? "is-selected" : ""}`}>
          <ParamIcon option={id} />
        </button>
      ))}
    </div>
  );
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
              <path d="M3 7.5l2.5 2.5L11 4.5" stroke={DARK_CHECK_SWATCHES.has(id) ? "#1D1D1F" : "#FFFFFF"} strokeWidth="2" fill="none" strokeLinecap="round" />
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

function Toast({ message, error, onClose }: { message: string; error?: boolean; onClose: () => void }) {
  return (
    <div className="toast" style={{ background: error ? C.accent : C.label }} role="status" aria-live="polite">
      {error ? <AlertCircle size={17} color="#fff" /> : <Check size={17} color="#fff" />}
      <span className="flex-1 text-sm leading-5 text-white">{message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="toast-dismiss"><X size={16} color="#fff" /></button>
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
        <section className="soft-card spectrum-card">
          <Skeleton height={150} radius={16} />
          <div className="spectrum-ticks">{["30", "500", "2k", "16k"].map((tick) => <Skeleton key={tick} width={34} />)}</div>
        </section>
        <div className="action-row">
          <Skeleton className="skeleton-fixed" width={88} height={88} radius="50%" />
          <Skeleton className="skeleton-grow" height={52} radius={999} />
        </div>
        <section className="soft-card controls-card">
          {["color", "band", "motion", "balance"].map((row) => (
            <div key={row} className="param-row">
              <div className="param-row-heading"><Skeleton width={68} height={15} /><Skeleton width={120} height={11} /></div>
              <Skeleton height={48} radius={16} />
            </div>
          ))}
        </section>
        <section className="soft-card variant-card">
          <Skeleton width="66%" height={14} />
          <div className="variant-meta mt-4"><Skeleton width={104} /><Skeleton width={74} /></div>
        </section>
      </div>
    </SkeletonPanel>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="soft-card queue-card">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row">
          <Skeleton className="skeleton-fixed" width={10} height={10} radius="50%" />
          <div className="skeleton-row-body"><Skeleton width="58%" height={14} /><Skeleton width="38%" height={11} /></div>
          <Skeleton className="skeleton-fixed" width={44} height={11} />
        </div>
      ))}
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <SkeletonPanel label="Loading rendered masters…">
      <div className="section-title"><Skeleton width={96} height={11} /></div>
      <div className="soft-card library-summary"><Skeleton width="52%" height={14} /><Skeleton className="mt-2" width="76%" height={10} /></div>
      <div className="library-list">
        {[0, 1, 2].map((card) => (
          <article key={card} className="soft-card track-card">
            <Skeleton width="46%" height={12} />
            <Skeleton className="mt-3" width="64%" height={15} />
            <Skeleton className="mt-3" height={38} radius={12} />
            <Skeleton className="mt-3" height={62} radius={12} />
            <div className="mt-3 flex gap-2"><Skeleton height={40} radius={12} /><Skeleton height={40} radius={12} /></div>
          </article>
        ))}
      </div>
    </SkeletonPanel>
  );
}

function QueueSkeleton() {
  return (
    <SkeletonPanel label="Loading render queue…">
      {["Active", "Completed today"].map((group) => (
        <section key={group} className="queue-group">
          <div className="section-title">{group}</div>
          <SkeletonRows rows={group === "Active" ? 2 : 3} />
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
          <article key={card} className="soft-card release-card">
            <div className="release-card-heading">
              <div className="min-w-0 flex-1"><Skeleton width={72} height={10} /><Skeleton className="mt-2" width="58%" height={18} /><Skeleton className="mt-2" width="42%" height={11} /></div>
              <Skeleton className="skeleton-fixed" width={58} height={20} radius={999} />
            </div>
            <div className="release-checklist"><Skeleton width={64} height={11} /><Skeleton width={48} height={11} /><Skeleton width={56} height={11} /><Skeleton width="70%" height={11} /></div>
          </article>
        ))}
      </div>
    </SkeletonPanel>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function Spectrum({ analyser, playing }: { analyser: AnalyserNode | null; playing: boolean }) {
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
    ctx.strokeStyle = "#e9e9eb";
    ctx.lineWidth = 1;
    for (let y = 22; y < 140; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    if (!analyser || !playing) return;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#ff3b30");
    gradient.addColorStop(0.45, "#ff9500");
    gradient.addColorStop(1, "#007aff");
    let frame = 0;
    const draw = () => {
      analyser.getByteFrequencyData(bins);
      ctx.clearRect(0, 0, width, 150);
      ctx.strokeStyle = "#e9e9eb";
      for (let y = 22; y < 140; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
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
  }, [analyser, playing]);
  return <canvas ref={ref} className="block h-[150px] w-full" aria-label="Approximate preview spectrum" />;
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

function useApproxPreview(variant: Variant | undefined) {
  const context = useRef<AudioContext | null>(null);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const lfos = useRef<OscillatorNode[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
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
    master.connect(analyser);
    analyser.connect(ctx.destination);
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
  }, [playing, stop, variant]);
  useEffect(() => stop, [variant, stop]);
  return { playing, toggle, stop, analyser: analyserRef.current };
}

export default function NoiseLab() {
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
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [everLoaded, setEverLoaded] = useState(false);
  const [queueRefreshing, setQueueRefreshing] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [introState, setIntroState] = useState<"visible" | "fading" | "hidden">("visible");
  const [tabInfoOpen, setTabInfoOpen] = useState(false);
  const [tabTitleVisible, setTabTitleVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
  const libraryReturnTab = useRef<"design" | "queue" | "releases" | null>(null);
  const retryInFlight = useRef(false);
  const tabsRef = useRef<HTMLElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const queueCount = jobs.filter((job) => job.status === "Queued" || job.status === "Rendering").length;
  const libraryCount = tracks.filter((track) => track.exists).length;
  const releaseCount = releases.filter((release) => release.ladder.ready && !release.ladder.submitted).length;
  const selected = useMemo(() => variants.find((variant) => variant.color === selection.color && variant.band === selection.band && variant.motion === selection.motion && variant.balance === selection.balance), [selection, variants]);
  const pilotCount = variants.filter((variant) => variant.pilot !== null).length;
  const preview = useApproxPreview(selected);
  const queueFetchInFlight = useRef(false);
  const initialLoad = loading && !everLoaded;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [variantResponse, libraryResponse, queueResponse, releasesResponse] = await Promise.all([fetch("/api/variants"), fetch("/api/library"), fetch("/api/queue"), fetch("/api/releases")]);
      setVariants((await variantResponse.json()).variants);
      setTracks((await libraryResponse.json()).tracks);
      const queuePayload = (await queueResponse.json()) as { jobs: QueueJob[]; mode?: "local" | "dispatch" | "unavailable"; stats?: typeof queueStats };
      setJobs(queuePayload.jobs);
      setQueueStats(queuePayload.stats ?? { medianRenderSeconds: null, sampleSize: 0 });
      if (queuePayload.mode) setRenderMode(queuePayload.mode);
      const releasesPayload = (await releasesResponse.json()) as { releases: DerivedRelease[]; mode?: "local" | "dispatch" | "unavailable" };
      setReleases(releasesPayload.releases);
      if (releasesPayload.mode) setReleaseMode(releasesPayload.mode);
    } catch { setToast({ message: "Could not load engine data.", error: true }); }
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
        (target ?? document.getElementById("panel-library"))?.scrollIntoView({ behavior: "smooth", block: "start" });
        if (target) {
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
      const selector = label === "pilot" ? { pilot: true } : label === "full" ? { full: true } : { variantIds: ids };
      const response = await fetch("/api/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selector) });
      if (!response.ok) {
        const reason = (await response.json().catch(() => ({}))) as { error?: string };
        setToast({ message: reason.error ?? "Queue request failed.", error: true });
        return;
      }
      const target = renderMode === "dispatch" ? "GitHub Actions renderer" : "worker queue";
      const colorLabel = OPTIONS.color.find(([value]) => value === selection.color)?.[1] ?? selection.color;
      setToast({
        message: label === "one"
          ? `${colorLabel} master and stems being rendered`
          : `${label === "pilot" ? "Pilot set" : `Full matrix (${variants.length} variants)`} sent to the ${target}.`,
      });
      await refresh();
    } finally {
      setQueueing(false);
    }
  }

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

  return (
    <main className="noise-shell min-h-screen w-full" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif' }}>
      {introState !== "hidden" && <div className={`intro-splash ${introState === "fading" ? "is-fading" : ""}`} aria-hidden="true"><BellMark /><span className="intro-wordmark">Noise Labs</span></div>}
      <div className="ambient-field ambient-field-a" />
      <div className="ambient-field ambient-field-b" />
      <div className="ambient-field ambient-field-c" />
      <div className="noise-page">
        <h1 className="sr-only">Noise Lab</h1>

        <div id="panel-design" role="tabpanel" aria-labelledby="tab-design" className={`panel ${tab === "design" ? "panel-show" : ""}`} hidden={tab !== "design"}>
          {initialLoad && !selected && <DesignSkeleton />}
          {selected && (
          <div className="design-stack">
            <section className="soft-card spectrum-card">
              <div className="spectrum-frame"><Spectrum analyser={preview.analyser} playing={preview.playing} /></div>
              <div className="spectrum-ticks"><span>30 Hz</span><span>500</span><span>2k</span><span>16k</span></div>
            </section>
            <div className="action-row">
              <button type="button" onClick={preview.toggle} aria-label={preview.playing ? "Stop approximate preview" : "Play approximate preview"} className="play-button">
                {preview.playing ? <Pause size={27} fill="white" strokeWidth={0} /> : <Play size={27} fill="white" strokeWidth={0} className="ml-1" />}
              </button>
              <button type="button" onClick={() => void queue([selected.variantId], "one")} disabled={queueing} className="queue-primary" title="Queues only the currently selected variant." aria-label={`Queue only the currently selected variant, variant #${selected.matrixIndex} of ${variants.length}`}>
                <Layers size={16} />
                <span>{queueing ? "Queueing…" : "Queue this render"}</span>
              </button>
            </div>
            <section className="soft-card controls-card">
              <ParamRow label="Color" caption={PARAM_CAPTIONS[selection.color]}><SwatchRow options={OPTIONS.color} value={selection.color} onChange={(value) => setSelection((old) => ({ ...old, color: value }))} label="Color" /></ParamRow>
              <ParamRow label="Band" caption={PARAM_CAPTIONS[selection.band]}><GlyphSegmented options={OPTIONS.band} value={selection.band} onChange={(value) => setSelection((old) => ({ ...old, band: value }))} label="Band" /></ParamRow>
              <ParamRow label="Motion" caption={PARAM_CAPTIONS[selection.motion]}><GlyphSegmented options={OPTIONS.motion} value={selection.motion} onChange={(value) => setSelection((old) => ({ ...old, motion: value }))} label="Motion" /></ParamRow>
              <ParamRow label="Balance" caption={PARAM_CAPTIONS[selection.balance]}><GlyphSegmented options={OPTIONS.balance} value={selection.balance} onChange={(value) => setSelection((old) => ({ ...old, balance: value }))} label="Balance" /></ParamRow>
            </section>
            <section className="soft-card variant-card">
              <div className="variant-id">{selected.variantId}</div>
              <div className="variant-meta"><span>Duration {formatDuration(selected.durationSeconds)}</span><span>Seed {selected.seeds.bed_l}</span></div>
              {selected.pilot && <div className="pilot-badge">Pilot {selected.pilot}</div>}
            </section>
          </div>
          )}
        </div>
        <div id="panel-library" role="tabpanel" aria-labelledby="tab-library" className={`panel ${tab === "library" ? "panel-show" : ""}`} hidden={tab !== "library"}><Library tracks={tracks} loading={loading} initialLoad={initialLoad} onRefresh={() => void refresh()} onToast={setToast} /></div>
        <div id="panel-queue" role="tabpanel" aria-labelledby="tab-queue" className={`panel ${tab === "queue" ? "panel-show" : ""}`} hidden={tab !== "queue"}><Queue jobs={jobs} initialLoad={initialLoad} mode={renderMode} stats={queueStats} variants={variants} tracks={tracks} onRefresh={() => void refreshQueue(true)} refreshing={queueRefreshing} onQueuePilot={() => void queue([], "pilot")} onQueueFull={() => void queue([], "full")} onRetry={retry} onDone={(job) => void openLibrary(knownVariantId(job.variantId, variants) ?? undefined)} queueing={queueing} pilotCount={pilotCount} matrixCount={variants.length} /></div>
        <div id="panel-releases" role="tabpanel" aria-labelledby="tab-releases" className={`panel ${tab === "releases" ? "panel-show" : ""}`} hidden={tab !== "releases"}><Releases releases={releases} releaseId={releaseId} variants={variants} tracks={tracks} mode={releaseMode} loading={loading} initialLoad={initialLoad} onRefresh={() => void refresh()} onToast={setToast} /></div>
      </div>
      <div className={`current-tab-title ${tabTitleVisible ? "" : "is-hidden"}`} aria-hidden={tabTitleVisible ? undefined : true}>
        <span key={tab}>{tab === "queue" ? "Render" : tab[0].toUpperCase() + tab.slice(1)}</span>
        <button type="button" className="info-button current-tab-title-info" tabIndex={tabTitleVisible ? 0 : -1} aria-label={`How to use ${tab === "queue" ? "Render" : tab[0].toUpperCase() + tab.slice(1)}`} aria-expanded={tabInfoOpen} aria-controls="current-tab-tooltip" onClick={() => setTabInfoOpen((open) => !open)}><Info size={16} /></button>
        {tabInfoOpen && <p id="current-tab-tooltip" role="note" className="current-tab-tooltip">{{
          design: "Dial in a variant, audition it, and queue the render.",
          queue: "Review queued and rendering jobs, retry failures, or open a finished master.",
          library: "Browse rendered masters and their QA evidence.",
          releases: "Assemble and ship releases from your rendered masters.",
        }[tab]}</p>}
      </div>
      <div className="dock"><nav ref={tabsRef} className="glassbar" role="tablist" aria-label="Primary">
        <div ref={lensRef} className="tab-lens" aria-hidden="true" />
        {(["design", "queue", "library", "releases"] as const).map((item) => {
          const count = item === "queue" ? queueCount : item === "library" ? libraryCount : item === "releases" ? releaseCount : 0;
          const label = item === "queue" ? "Render" : item[0].toUpperCase() + item.slice(1);
          const Icon = TAB_ICONS[item];
          return <button key={item} id={`tab-${item}`} type="button" data-tab={item} role="tab" aria-controls={`panel-${item}`} aria-selected={tab === item} aria-label={`${label}${count ? `, ${count}` : ""}`} title={label} onClick={() => {
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
            window.scrollTo({ top: 0, behavior: "smooth" });
          }} className={`dock-tab ${tab === item ? "is-active" : ""}`}><span className="dock-tab-icon" aria-hidden="true"><Icon size={22} strokeWidth={2.1} />{count > 0 && <span className={`count-badge ${item === "library" ? "dim" : ""}`}>{count}</span>}</span></button>;
        })}
      </nav></div>
      {toast && <Toast message={toast.message} error={toast.error} onClose={() => setToast(null)} />}
    </main>
  );
}

function Library({ tracks, loading, initialLoad, onRefresh, onToast }: { tracks: LibraryTrack[]; loading: boolean; initialLoad: boolean; onRefresh: () => void; onToast: (toast: { message: string; error?: boolean }) => void }) {
  if (initialLoad) {
    return (
      <section className="panel-section">
        <div className="panel-heading"><div><h2>Library</h2><p>Rendered masters and QA evidence</p></div><button type="button" disabled aria-busy="true" className="round-action is-refreshing" aria-label="Refresh library"><RefreshCw size={14} /></button></div>
        <LibrarySkeleton />
      </section>
    );
  }
  return (
    <section className="panel-section">
      <div className="panel-heading"><div><h2>Library</h2><p>Rendered masters and QA evidence</p></div><button type="button" onClick={onRefresh} disabled={loading} aria-busy={loading} className={`round-action ${loading ? "is-refreshing" : ""}`} aria-label="Refresh library"><RefreshCw size={14} /></button></div>
      <div className="section-title">Masters · {tracks.filter((track) => track.exists).length}</div>
      <div className="soft-card library-summary"><div className="font-medium">{tracks.filter((track) => track.exists).length} of {tracks.length} variants rendered</div><div className="mt-1 break-all font-mono text-[10px] text-[color:var(--secondary-text)]">Reading {tracks[0]?.path.replace(/\/[^/]+$/, "") ?? "configured render directory"}</div></div>
      <div className="library-list">
        {tracks.filter((track) => track.exists).length === 0 && <div className="soft-card empty-state">No rendered files found in the directory above.</div>}
        {tracks.filter((track) => track.exists).map((track) => <TrackCard key={track.variantId} track={track} onToast={onToast} />)}
      </div>
    </section>
  );
}

function TrackCard({ track, onToast }: { track: LibraryTrack; onToast: (toast: { message: string; error?: boolean }) => void }) {
  const [suggestion, setSuggestion] = useState<{ title: string; description: string; prompt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState(0);
  async function generate() {
    setBusy(true);
    const response = await fetch("/api/names/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: track.variantId, candidate }) });
    const payload = await response.json();
    setSuggestion(payload.suggestion);
    setBusy(false);
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
  return (
    <article id={`track-${track.variantId}`} className="soft-card track-card">
      <div>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-mono text-[11px]">{track.variantId}</div>{track.title && <div className="mt-1 truncate text-sm font-semibold">{track.title}{track.titleApproved && <span className="ml-1 text-[10px] font-normal text-[#187a35]">approved</span>}</div>}<div className="mt-1 text-[12px] text-[color:var(--secondary-text)]">Matrix {track.matrixIndex} · {formatDuration(track.durationSeconds)} · {track.color} / {track.band} / {track.motion}</div></div><span className={`rounded-full px-2 py-1 font-mono text-[10px] font-semibold ${track.qaVerdict === "PASS" ? "bg-green-50 text-[#187a35]" : track.qaVerdict === "FAIL" ? "bg-red-50 text-[#b42318]" : "bg-gray-100 text-[color:var(--secondary-text)]"}`}>{track.qaVerdict}</span></div>
        <audio className="mt-3 w-full" controls preload="none" src={track.audioUrl} />
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#f2f2f7] p-3 text-xs"><div><span className="text-[color:var(--secondary-text)]">LUFS</span><div className="mt-0.5 font-mono font-semibold">{track.measuredLufs ?? "—"}</div></div><div><span className="text-[color:var(--secondary-text)]">True peak</span><div className="mt-0.5 font-mono font-semibold">{track.measuredTruePeak ?? "—"}</div></div></div>
        <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-[#005bb5]">Show QA checks</summary><div className="mt-2 space-y-1">{track.qaChecks.map((check) => <div key={check.name} className="flex justify-between gap-2 border-t border-[#d8d8dc] py-1.5 text-[11px]"><span>{check.passed ? "✓" : "×"} {check.name}</span><span className="font-mono text-[color:var(--secondary-text)]">{check.measured}</span></div>)}</div></details>
        <div className="mt-3 flex gap-2"><a href={track.downloadUrl} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#e9e9eb] py-2.5 text-xs font-medium"><Download size={14} /> Download master</a><button type="button" onClick={() => void generate()} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1c1c1e] py-2.5 text-xs font-medium text-white"><Sparkles size={14} /> {busy ? "Thinking…" : "Suggest SEO name"}</button></div>
        {Boolean(track.stems.length) && <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]"><span className="text-[color:var(--secondary-text)]">Stems</span>{track.stems.map((stem) => stem.exists ? <a key={stem.filename} href={stem.downloadUrl} className="rounded-lg bg-[#f2f2f7] px-2 py-1 font-medium">{stem.number}. {stem.stem}</a> : <span key={stem.filename} className="rounded-lg px-2 py-1 text-[color:var(--secondary-text)]">{stem.number}. {stem.stem} —</span>)}</div>}
        {suggestion && <div className="mt-3 rounded-xl border border-[#d8d8dc] p-3"><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--secondary-text)]">Review before approval</div><input value={suggestion.title} onChange={(event) => setSuggestion({ ...suggestion, title: event.target.value })} className="w-full border-b border-[#d8d8dc] pb-1 text-sm font-semibold outline-none" /><textarea value={suggestion.description} onChange={(event) => setSuggestion({ ...suggestion, description: event.target.value })} className="mt-2 h-16 w-full resize-none text-xs leading-4 outline-none" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => void regenerate()} disabled={busy} className="rounded-lg px-2 py-1.5 text-xs text-[#005bb5] disabled:text-[color:var(--secondary-text)]">Regenerate</button><button type="button" onClick={() => void approve()} disabled={busy} className="rounded-lg bg-[#34c759] px-3 py-1.5 text-xs font-semibold text-white disabled:bg-[#c7c7cc]">{busy ? "Approving…" : "Approve"}</button></div></div>}
      </div>
    </article>
  );
}

function Releases({ releases, releaseId, variants, tracks, mode, loading, initialLoad, onRefresh, onToast }: {
  releases: DerivedRelease[];
  releaseId?: string;
  variants: Variant[];
  tracks: LibraryTrack[];
  mode: "local" | "dispatch" | "unavailable";
  loading: boolean;
  initialLoad: boolean;
  onRefresh: () => void;
  onToast: (toast: { message: string; error?: boolean }) => void;
}) {
  const release = releases.find((candidate) => candidate.id === releaseId);
  if (!releaseId || !release) {
    return <ReleaseList releases={releases} loading={loading} initialLoad={initialLoad} onRefresh={onRefresh} />;
  }
  return <ReleaseDetail release={release} savedArtist={releases.find((candidate) => !candidate.unsaved)?.artist} variants={variants} tracks={tracks} mode={mode} onRefresh={onRefresh} onToast={onToast} />;
}

function ReleaseList({ releases, loading, initialLoad, onRefresh }: { releases: DerivedRelease[]; loading: boolean; initialLoad: boolean; onRefresh: () => void }) {
  return (
    <section className="panel-section">
      <div className="panel-heading">
        <div><h2>Releases</h2><p>Prepare rendered masters for distribution</p></div>
        <button type="button" onClick={onRefresh} disabled={loading} aria-busy={loading} className={`round-action ${loading ? "is-refreshing" : ""}`} aria-label="Refresh releases"><RefreshCw size={14} /></button>
      </div>
      {initialLoad && <ReleasesSkeleton />}
      <div className="release-list">
        {!initialLoad && releases.length === 0 && <div className="soft-card empty-state">No releases yet.</div>}
        {releases.map((release) => (
          <article key={release.id} className="soft-card release-card" tabIndex={0} role="button" onClick={() => { window.location.hash = `releases/${encodeURIComponent(release.id)}`; }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") window.location.hash = `releases/${encodeURIComponent(release.id)}`; }}>
            <div className="release-card-heading"><div className="min-w-0 text-left"><div className="release-kicker">{release.unsaved ? "Suggested preset" : release.type.toUpperCase()}</div><h3>{release.title}</h3><p>{release.artist} · {release.tracks.length} tracks</p></div><span className={`release-state release-state-${release.state.toLowerCase()}`}>{release.state}</span></div>
            <div className="release-checklist" aria-label={`${release.state}: ${release.blockingItem}`}><span className={release.ladder.named ? "release-stage-done" : "release-stage-pending"}>{release.ladder.named ? "✓" : "○"} Named</span><span className={release.ladder.art ? "release-stage-done" : "release-stage-pending"}>{release.ladder.art ? "✓" : "○"} Art</span><span className={release.ladder.ready ? "release-stage-done" : "release-stage-pending"}>{release.ladder.ready ? "✓" : "○"} Ready</span>{release.ladder.submitted && <span className="release-stage-done">✓ Submitted</span>}<span className="release-blocker">{release.blockingItem}</span></div>
            {release.unsaved && release.id === "pilot-ep" && <div className="release-preset-hint">Start with the pilot EP (8 tracks)</div>}
            {release.submitted.storeUrl && <a href={release.submitted.storeUrl} target="_blank" rel="noreferrer" className="release-store-link" onClick={(event) => event.stopPropagation()}>Submitted · open in store ↗</a>}
          </article>
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
      {mode === "unavailable" && <div className="soft-card unavailable-note">Releases are edited where a writer is configured; this deployment is read-only.</div>}
      <section className="soft-card release-section"><div className="section-title">Metadata</div><div className="release-fields">
        {(["artist", "title", "genre", "secondaryGenre", "songwriter"] as const).map((field) => <label key={field} className="release-field"><span>{field === "secondaryGenre" ? "Secondary genre" : field[0].toUpperCase() + field.slice(1)}</span><input value={draft[field]} disabled={mode === "unavailable"} onChange={(event) => update({ [field]: event.target.value })} /></label>)}
        <label className="release-field"><span>Release date</span><input type="date" value={draft.releaseDate} disabled={mode === "unavailable"} onChange={(event) => update({ releaseDate: event.target.value })} /></label>
      </div></section>
      <section className="soft-card release-section"><div className="section-title">Tracklist · {draft.tracks.length}</div>
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
        <div className="release-track-actions"><button type="button" className="queue-secondary" disabled={busy || mode === "unavailable"} onClick={() => void generateNames()}><Sparkles size={14} /> Generate names</button><button type="button" className="queue-primary" disabled={busy || mode === "unavailable" || lint.hardFailures.length > 0 || !namesReady} onClick={() => void approveNames()}>Approve names</button></div>
      </section>
      <section className="soft-card release-section"><div className="section-title">Cover art</div><div className="cover-art-frame">{draft.artSeed === null ? <div className="empty-state">No art yet — generate a seed below.</div> : <canvas ref={artPreview} width="240" height="240" aria-label="Generated cover art preview" />}</div><div className="cover-art-actions"><button type="button" className="queue-secondary" disabled={mode === "unavailable"} onClick={regenerateArt}>{draft.artSeed === null ? "Generate cover art" : "Regenerate"}</button>{draft.artSeed !== null && <button type="button" className="queue-secondary cover-download" onClick={downloadArt}><Download size={14} /> Download PNG</button>}</div></section>
      <div className="release-footer"><div className="release-footer-status" aria-live="polite"><strong>{release.state}</strong><span>{release.blockingItem}</span></div><button type="button" className="queue-primary" disabled={busy || mode === "unavailable" || (release.state === "Ready" && !namesReady)} onClick={() => void footerAction()}>{footerLabel}</button></div>
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
    <section className="soft-card release-section"><div className="section-title">Release metadata</div>{[
      ["Artist", release.artist], ["Release title", release.title], ["Number of songs", String(release.tracks.length)], ["Genre", release.genre], ["Secondary genre", release.secondaryGenre], ["Release date", release.releaseDate], ["Songwriter", release.songwriter],
    ].map(([label, value]) => <div className="copy-field" key={label}><div><span>{label}</span><strong>{value || "Not set"}</strong></div><button type="button" className="copy-button" disabled={!value} onClick={() => onCopy(value, label)} aria-label={`Copy ${label}`}><Clipboard size={16} /> Copy</button></div>)}</section>
    <section className="soft-card release-section"><div className="section-title">Tracklist</div>{release.tracks.map((track, index) => <div className="copy-field" key={track.variantId}><div><span>{index + 1}. Track title · Songwriter</span><strong>{track.title} · {release.songwriter || "Not set"}</strong></div><div className="copy-actions"><button type="button" className="copy-button" onClick={() => onCopy(track.title, `Track ${index + 1} title`)}><Clipboard size={16} /> Copy</button>{byId.get(track.variantId)?.exists && <a className="copy-button" href={byId.get(track.variantId)?.downloadUrl} download><Download size={16} /> WAV</a>}</div></div>)}</section>
    <section className="soft-card release-section"><div className="section-title">Store answers</div><p className="handoff-note">Not explicit · Instrumental · No radio edit</p><p className="handoff-note">Masters: 48 kHz/24-bit WAV · −20 LUFS / −3 dBTP</p></section>
    <section className="soft-card release-section"><div className="section-title">Mark submitted</div><label className="release-field"><span>DistroKid or Spotify URL (optional)</span><input value={storeUrl} onChange={(event) => setStoreUrl(event.target.value)} placeholder="https://" /></label><button type="button" className="queue-primary handoff-submit" disabled={mode === "unavailable"} onClick={() => void onSubmit(storeUrl)}>Mark submitted</button></section>
  </section>;
}

const QUEUE_NOTES: Record<string, string> = {
  local: "Queueing writes a JSONL job for the separate Python worker. This console does not pretend that Audacity renders complete inside an HTTP request.",
  dispatch: "Queueing dispatches a GitHub Actions run that installs Audacity, renders, runs QA, and publishes the master to object storage. Status here mirrors the workflow run.",
  unavailable: "This deployment has no renderer configured, so it browses published masters only.",
};

function Queue({ jobs, initialLoad, mode, stats, variants, tracks, onRefresh, refreshing, onQueuePilot, onQueueFull, onRetry, onDone, queueing, pilotCount, matrixCount }: { jobs: QueueJob[]; initialLoad: boolean; mode: "local" | "dispatch" | "unavailable"; stats: { medianRenderSeconds: number | null; sampleSize: number }; variants: Variant[]; tracks: LibraryTrack[]; onRefresh: () => void; refreshing: boolean; onQueuePilot: () => void; onQueueFull: () => void; onRetry: (job: QueueJob) => Promise<boolean>; onDone: (job: QueueJob) => void; queueing: boolean; pilotCount: number; matrixCount: number }) {
  const activeJobs = jobs.filter((job) => job.status === "Queued" || job.status === "Rendering");
  const [retried, setRetried] = useState<Set<string>>(new Set());
  const [confirmingFull, setConfirmingFull] = useState(false);
  const [confirmingRetryId, setConfirmingRetryId] = useState<string | null>(null);
  const pilotActionLabel = `Queue pilot set (${pilotCount})`;
  const pilotActionTitle = mode === "unavailable"
    ? "Rendering isn't available on this deployment."
    : `Queues the whole curated pilot set from config/variants_pilot.yaml — every pilot variant, regardless of what's selected on the Design tab. (${pilotCount} variants)`;
  const fullActionLabel = `Render full matrix (${matrixCount})`;
  const fullActionTitle = mode === "unavailable"
    ? "Rendering isn't available on this deployment."
    : `Renders every variant in config/variants.yaml, regardless of what's selected on the Design tab. (${matrixCount} variants)`;
  const pilotMembers = variants.filter((variant) => variant.pilot !== null).map((variant) => variant.variantId);
  const fullMembers = variants.map((variant) => variant.variantId);
  const partition = partitionRenderJobs(jobs, pilotMembers, fullMembers);
  const completedBuckets = groupCompletedByDay(partition.completed);
  useEffect(() => {
    if (!confirmingFull) return;
    const timer = setTimeout(() => setConfirmingFull(false), 8000);
    return () => clearTimeout(timer);
  }, [confirmingFull]);
  useEffect(() => {
    if (confirmingRetryId === null) return;
    const timer = setTimeout(() => setConfirmingRetryId(null), 8000);
    return () => clearTimeout(timer);
  }, [confirmingRetryId]);
  const elapsed = (job: QueueJob) => job.startedAt ? (Date.now() - new Date(job.startedAt).getTime()) / 1000 : 0;
  const activeCopy = (job: QueueJob) => mode === "local"
    ? job.status === "Queued" ? queueAheadLabel(queuedJobsAhead(job.id, jobs)) : "Worker is rendering"
    : job.status === "Rendering"
      ? `${renderEstimate(stats.medianRenderSeconds, stats.sampleSize, elapsed(job))} left`
      : stats.sampleSize ? `Typically ${renderEstimate(stats.medianRenderSeconds, stats.sampleSize)} once started` : renderEstimate(null, 0);
  const renderingCount = activeJobs.filter((job) => job.status === "Rendering").length;
  const queuedCount = activeJobs.filter((job) => job.status === "Queued").length;
  const summary = initialLoad
    ? "Checking the queue…"
    : activeJobs.length
      ? [renderingCount ? `${renderingCount} rendering` : "", queuedCount ? `${queuedCount} queued` : "", mode === "dispatch" ? `${renderEstimate(stats.medianRenderSeconds, stats.sampleSize, Math.max(...activeJobs.map(elapsed), 0))} remaining` : ""].filter(Boolean).join(" · ")
      : "Queue idle";
  const nameFor = (job: QueueJob) => isBatchVariantId(job.variantId)
    ? formatBatchLabel(job.variantId, { pilot: pilotCount, full: matrixCount })
    : formatVariantLabel(job.variantId, variants);
  const attempts = (job: RenderJob) => job.attempts.map((attempt) => (
    <div className="queue-attempt" key={attempt.id}>
      <span className={`status-dot ${attempt.status.toLowerCase()}`} />
      <span>{attempt.status}</span>
      <time className="queue-time" title={absoluteTime(attempt.queuedAt)}>{relativeTime(attempt.queuedAt)}</time>
      {attempt.logsUrl && <a href={attempt.logsUrl} target="_blank" rel="noopener" className="queue-link queue-logs">View logs</a>}
    </div>
  ));
  const card = (job: RenderJob, history = false) => {
    const latest = job.latest;
    const done = latest.status === "Done";
    const attention = latest.status === "Failed" || latest.status === "Cancelled";
    const batch = isBatchVariantId(latest.variantId);
    const name = nameFor(latest);
    const batchMembers = batchMembersForJob(latest, pilotMembers, fullMembers);
    const missingMasters = batchMissingMastersSummary(batchMembers, tracks);
    const failureVerb = latest.status === "Cancelled" ? "cancelled" : "failed";
    const failureCopy = !batch
      ? latest.error ?? (latest.status === "Cancelled" ? "Render cancelled" : "Render failed")
      : missingMasters
        ? missingMasters.missingVariantIds.length
          ? `${name} render ${failureVerb} — ${missingMasters.missingVariantIds.length} of ${missingMasters.total} have no master yet`
          : `${name} render ${failureVerb} — all ${missingMasters.total} batch variants have masters; a full retry likely isn't needed`
        : `${name} render ${failureVerb} — see logs for which variant(s)`;
    const retry = async () => {
      if (await onRetry(latest)) {
        setRetried((old) => new Set(old).add(latest.id));
        setConfirmingRetryId(null);
      }
    };
    const alreadyRetried = retried.has(latest.id);
    const retryControl = !history && attention && mode !== "unavailable" && (
      latest.variantId === "full" && confirmingRetryId === job.variantId ? (
        <>
          <button type="button" className="queue-link queue-retry" disabled={queueing} aria-label={`Confirm retrying ${name}`} onClick={() => void retry()}>Re-render entire {name}</button>
          <button type="button" className="queue-link queue-cancel" onClick={() => setConfirmingRetryId(null)} aria-label={`Cancel retrying ${name}`}>Cancel</button>
        </>
      ) : (
        <button type="button" disabled={queueing || alreadyRetried} onClick={() => latest.variantId === "full" ? setConfirmingRetryId(job.variantId) : void retry()} className="queue-link queue-retry" aria-label={alreadyRetried ? `${name} was already retried` : `Retry ${name}`}>{alreadyRetried ? "Retried ✓" : "Retry"}</button>
      )
    );
    const displayTime = done ? latest.finishedAt ?? latest.queuedAt : latest.queuedAt;
    const content = <><span className={`status-dot ${latest.status.toLowerCase()}`} /><div className="queue-body"><div className="queue-name" title={`${latest.variantId} · Run ${latest.id}`}>{name}{history ? ` · ${latest.status}` : ""}</div><div className="queue-sub" title={latest.error}>{done ? "Master ready · Open in Library ›" : attention ? <>{failureCopy}{missingMasters?.missingVariantIds.length ? <details className="queue-missing"><summary>Show variants</summary><ul>{missingMasters.missingVariantIds.map((variantId) => <li key={variantId}>{formatVariantLabel(variantId, variants)}</li>)}</ul></details> : null}</> : activeCopy(latest)}</div>{attention && <div className="queue-actions">{latest.logsUrl && <a href={latest.logsUrl} target="_blank" rel="noopener" className="queue-link queue-logs">View logs</a>}{retryControl}</div>}{job.attempts.length > 1 && <details className="queue-attempts"><summary>{job.attempts.length} attempts ›</summary>{attempts(job)}</details>}</div><time className="queue-time" title={absoluteTime(displayTime)}>{relativeTime(displayTime)}</time></>;
    if (history) return <div className="queue-item queue-history-job" key={job.variantId}>{content}</div>;
    return done ? <button type="button" key={job.variantId} className="queue-item queue-link-row" onClick={() => onDone(latest)}>{content}</button> : <div key={job.variantId} className="queue-item">{content}</div>;
  };
  const group = (title: string, entries: RenderJob[], empty: string) => <section className="queue-group"><div className="section-title">{title}</div><div className="soft-card queue-card">{entries.length === 0 ? <div className="empty-state">{empty}</div> : entries.map((job) => card(job))}</div></section>;
  return (
    <section className="panel-section">
      <div className="panel-heading"><div><div className="queue-heading-line"><h2>Render queue</h2><span className="mode-chip">{mode === "dispatch" ? "GitHub Actions" : mode === "local" ? "Local worker" : "Browse only"}</span></div><p className="queue-summary" aria-live="polite">{summary}</p></div><div className="panel-heading-actions"><button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing} className={`round-action ${refreshing || initialLoad ? "is-refreshing" : ""}`} aria-label="Refresh queue"><RefreshCw size={14} /></button></div></div>
      {initialLoad && <QueueSkeleton />}
      {partition.needsAttention.length > 0 && group("Needs attention", partition.needsAttention, "Nothing needs attention")}
      {partition.history.length > 0 && <details className="queue-history"><summary>History ({partition.history.length})</summary><div className="soft-card queue-card">{partition.history.map((job) => card(job, true))}</div></details>}
      {!initialLoad && <>{group("Active", partition.active, "No active renders — open Start renders below")}{completedBuckets.map((bucket) => <section className="queue-group" key={bucket.label}><div className="section-title">{bucket.label}</div><div className="soft-card queue-card">{bucket.jobs.map((job) => card(job))}</div></section>)}</>}
      <details className="start-renders"><summary>Start renders <span>· pilot ({pilotCount}) or full matrix ({matrixCount})</span></summary><div className="bulk-actions"><div className="bulk-action"><button type="button" onClick={onQueuePilot} disabled={mode === "unavailable" || queueing} className="queue-secondary" title={pilotActionTitle} aria-label={pilotActionTitle}><Layers size={14} /> {pilotActionLabel}</button><p className="bulk-action-caption">All {pilotCount} pilot variants, ignores Design selection</p></div><div className="bulk-action">{confirmingFull ? <div className="bulk-confirm"><button type="button" onClick={() => { setConfirmingFull(false); onQueueFull(); }} disabled={queueing} className="queue-primary" aria-label={`Confirm rendering all ${matrixCount} variants`}>Confirm {matrixCount} renders</button><button type="button" onClick={() => setConfirmingFull(false)} className="queue-secondary">Cancel</button></div> : <button type="button" onClick={() => setConfirmingFull(true)} disabled={mode === "unavailable" || matrixCount === 0 || queueing} className="queue-secondary" title={fullActionTitle} aria-label={fullActionTitle}><Grid3x3 size={14} /> {fullActionLabel}</button>}<p className="bulk-action-caption">{confirmingFull ? `Tap confirm to dispatch all ${matrixCount} renders.` : `All ${matrixCount} variants, ignores Design selection`}</p></div></div><p className="queue-note">{QUEUE_NOTES[mode]}</p></details>
    </section>
  );
}
