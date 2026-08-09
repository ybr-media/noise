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
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryTrack, QueueJob, Release, ReleaseTrack, Variant } from "@/lib/types";
import type { DerivedRelease } from "@/lib/releases";
import { toReleaseDocument } from "@/lib/release-document";
import { mulberry32, renderCoverArt, type CoverArtDimensions } from "@/lib/cover-art";
import { lintNames } from "@/lib/name-lint";
import { knownVariantId, queueAheadLabel, queuedJobsAhead, relativeTime, renderEstimate } from "@/lib/eta";
import { BellMark } from "./bell-mark";

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

const OPTIONS = {
  color: [
    ["white", "White"], ["green", "Green"], ["pink", "Pink"], ["brown", "Brown"],
  ],
  band: [
    ["low-mid", "Low-mid"], ["mid", "Mid"], ["high", "High"], ["broad", "Broad"],
  ],
  motion: [
    ["still", "Still"], ["drift", "Drift"], ["breathing", "Breathing"],
  ],
  balance: [
    ["bed-forward", "Bed"], ["balanced", "Even"], ["texture-forward", "Texture"],
  ],
} as const;

function Segmented({ options, value, onChange, label }: {
  options: readonly (readonly [string, string])[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="mini-segmented" role="radiogroup" aria-label={label}>
      {options.map(([id, name]) => (
        <button key={id} type="button" onClick={() => onChange(id)} aria-checked={value === id} role="radio"
          className={`mini-segment ${value === id ? "is-selected" : ""}`}>
          {name}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="design-row">
      <div>
        <div className="design-label">{label}</div>
        <div className="design-hint">{hint}</div>
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
  const [queueRefreshing, setQueueRefreshing] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const libraryReturnTab = useRef<"design" | "queue" | "releases" | null>(null);
  const retryInFlight = useRef(false);
  const dockRef = useRef<HTMLElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const queueCount = jobs.filter((job) => job.status !== "Done" && job.status !== "Failed").length;
  const libraryCount = tracks.filter((track) => track.exists).length;
  const releaseCount = releases.filter((release) => release.ladder.ready && !release.ladder.submitted).length;
  const selected = useMemo(() => variants.find((variant) => variant.color === selection.color && variant.band === selection.band && variant.motion === selection.motion && variant.balance === selection.balance), [selection, variants]);
  const pilotCount = variants.filter((variant) => variant.pilot !== null).length;
  const preview = useApproxPreview(selected);
  const queueFetchInFlight = useRef(false);

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
    finally { setLoading(false); }
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
    const updateVisibility = () => setDocumentVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);
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
    const dock = dockRef.current;
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
      <div className="ambient-field ambient-field-a" />
      <div className="ambient-field ambient-field-b" />
      <div className="ambient-field ambient-field-c" />
      <div className="noise-page">
        <header className="noise-header">
          <div className="noise-heading">
            <h1 className="noise-title"><span className="sr-only">Noise Lab</span><BellMark /></h1>
            <button type="button" onClick={() => setAboutOpen((open) => !open)} aria-label="About Noise Lab" aria-expanded={aboutOpen} className="info-button"><Info size={20} /></button>
            {aboutOpen && <p role="note" className="noise-about">Design a variant, review masters, queue the worker.</p>}
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} aria-busy={loading} aria-label="Refresh" className={`refresh-button ${loading ? "is-refreshing" : ""}`}><RefreshCw size={21} /></button>
        </header>

        <div id="panel-design" role="tabpanel" aria-labelledby="tab-design" className={`panel ${tab === "design" ? "panel-show" : ""}`} hidden={tab !== "design"}>
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
              <button type="button" onClick={() => void queue([selected.variantId], "one")} disabled={queueing} className="queue-primary" title="Queues only the currently selected variant." aria-label="Queue only the currently selected variant"><Layers size={16} /> {queueing ? "Queueing…" : "Queue this render"}</button>
            </div>
            <div className="matrix-label">Matrix {selected.matrixIndex} of {variants.length}</div>
            <section className="soft-card controls-card">
              <Row label="Color" hint={selected.spectrum.bell ? "+6 dB bell @ 500 Hz" : `${selected.spectrum.tiltDbPerOct} dB/oct`}><Segmented options={OPTIONS.color} value={selection.color} onChange={(value) => setSelection((old) => ({ ...old, color: value }))} label="Color" /></Row>
              <Row label="Band" hint={`${selected.band} texture`}><Segmented options={OPTIONS.band} value={selection.band} onChange={(value) => setSelection((old) => ({ ...old, band: value }))} label="Band" /></Row>
              <Row label="Motion" hint={`${selected.motion} modulation`}><Segmented options={OPTIONS.motion} value={selection.motion} onChange={(value) => setSelection((old) => ({ ...old, motion: value }))} label="Motion" /></Row>
              <Row label="Balance" hint={`${selected.balance} mix`}><Segmented options={OPTIONS.balance} value={selection.balance} onChange={(value) => setSelection((old) => ({ ...old, balance: value }))} label="Balance" /></Row>
            </section>
            <section className="soft-card variant-card">
              <div className="variant-id">{selected.variantId}</div>
              <div className="variant-meta"><span>Duration {formatDuration(selected.durationSeconds)}</span><span>Seed {selected.seeds.bed_l}</span></div>
              {selected.pilot && <div className="pilot-badge">Pilot {selected.pilot}</div>}
            </section>
          </div>
          )}
        </div>
        <div id="panel-library" role="tabpanel" aria-labelledby="tab-library" className={`panel ${tab === "library" ? "panel-show" : ""}`} hidden={tab !== "library"}><Library tracks={tracks} loading={loading} onRefresh={() => void refresh()} onToast={setToast} /></div>
        <div id="panel-queue" role="tabpanel" aria-labelledby="tab-queue" className={`panel ${tab === "queue" ? "panel-show" : ""}`} hidden={tab !== "queue"}><Queue jobs={jobs} mode={renderMode} stats={queueStats} variants={variants} onRefresh={() => void refreshQueue(true)} refreshing={queueRefreshing} onQueuePilot={() => void queue([], "pilot")} onQueueFull={() => void queue([], "full")} onRetry={retry} onDone={(job) => void openLibrary(knownVariantId(job.variantId, variants) ?? undefined)} queueing={queueing} pilotCount={pilotCount} matrixCount={variants.length} /></div>
        <div id="panel-releases" role="tabpanel" aria-labelledby="tab-releases" className={`panel ${tab === "releases" ? "panel-show" : ""}`} hidden={tab !== "releases"}><Releases releases={releases} releaseId={releaseId} variants={variants} tracks={tracks} mode={releaseMode} loading={loading} onRefresh={() => void refresh()} onToast={setToast} /></div>
      </div>
      <div className="dock"><nav ref={dockRef} className="glassbar" role="tablist" aria-label="Primary">
        <div ref={lensRef} className="tab-lens" aria-hidden="true" />
        {(["design", "queue", "library", "releases"] as const).map((item) => {
          const count = item === "queue" ? queueCount : item === "library" ? libraryCount : item === "releases" ? releaseCount : 0;
          return <button key={item} id={`tab-${item}`} type="button" data-tab={item} role="tab" aria-controls={`panel-${item}`} aria-selected={tab === item} aria-label={`${item[0].toUpperCase()}${item.slice(1)}${count ? `, ${count}` : ""}`} onClick={() => {
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
          }} className={`dock-tab ${tab === item ? "is-active" : ""}`}>{item[0].toUpperCase() + item.slice(1)}{count > 0 && <span className={`count-badge ${item === "library" ? "dim" : ""}`}>{count}</span>}</button>;
        })}
      </nav></div>
      {toast && <Toast message={toast.message} error={toast.error} onClose={() => setToast(null)} />}
    </main>
  );
}

function Library({ tracks, loading, onRefresh, onToast }: { tracks: LibraryTrack[]; loading: boolean; onRefresh: () => void; onToast: (toast: { message: string; error?: boolean }) => void }) {
  return (
    <section className="panel-section">
      <div className="panel-heading"><div><h2>Library</h2><p>Rendered masters and QA evidence</p></div><button type="button" onClick={onRefresh} disabled={loading} aria-busy={loading} className={`round-action ${loading ? "is-refreshing" : ""}`} aria-label="Refresh library"><RefreshCw size={14} /></button></div>
      <div className="section-title">Masters · {tracks.filter((track) => track.exists).length}</div>
      <div className="soft-card library-summary"><div className="font-medium">{tracks.filter((track) => track.exists).length} of {tracks.length} variants rendered</div><div className="mt-1 break-all font-mono text-[10px] text-[color:var(--secondary-text)]">Reading {tracks[0]?.path.replace(/\/[^/]+$/, "") ?? "configured render directory"}</div></div>
      <div className="library-list">
        {loading && <div className="soft-card empty-state">Loading render directory…</div>}
        {!loading && tracks.filter((track) => track.exists).length === 0 && <div className="soft-card empty-state">No rendered files found in the directory above.</div>}
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

function Releases({ releases, releaseId, variants, tracks, mode, loading, onRefresh, onToast }: {
  releases: DerivedRelease[];
  releaseId?: string;
  variants: Variant[];
  tracks: LibraryTrack[];
  mode: "local" | "dispatch" | "unavailable";
  loading: boolean;
  onRefresh: () => void;
  onToast: (toast: { message: string; error?: boolean }) => void;
}) {
  const release = releases.find((candidate) => candidate.id === releaseId);
  if (!releaseId || !release) {
    return <ReleaseList releases={releases} loading={loading} onRefresh={onRefresh} />;
  }
  return <ReleaseDetail release={release} savedArtist={releases.find((candidate) => !candidate.unsaved)?.artist} variants={variants} tracks={tracks} mode={mode} onRefresh={onRefresh} onToast={onToast} />;
}

function ReleaseList({ releases, loading, onRefresh }: { releases: DerivedRelease[]; loading: boolean; onRefresh: () => void }) {
  return (
    <section className="panel-section">
      <div className="panel-heading">
        <div><h2>Releases</h2><p>Prepare rendered masters for distribution</p></div>
        <button type="button" onClick={onRefresh} disabled={loading} aria-busy={loading} className={`round-action ${loading ? "is-refreshing" : ""}`} aria-label="Refresh releases"><RefreshCw size={14} /></button>
      </div>
      <div className="release-list">
        {releases.length === 0 && <div className="soft-card empty-state">No releases yet.</div>}
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

function Queue({ jobs, mode, stats, variants, onRefresh, refreshing, onQueuePilot, onQueueFull, onRetry, onDone, queueing, pilotCount, matrixCount }: { jobs: QueueJob[]; mode: "local" | "dispatch" | "unavailable"; stats: { medianRenderSeconds: number | null; sampleSize: number }; variants: Variant[]; onRefresh: () => void; refreshing: boolean; onQueuePilot: () => void; onQueueFull: () => void; onRetry: (job: QueueJob) => Promise<boolean>; onDone: (job: QueueJob) => void; queueing: boolean; pilotCount: number; matrixCount: number }) {
  const activeJobs = jobs.filter((job) => job.status === "Queued" || job.status === "Rendering");
  const failedJobs = jobs.filter((job) => job.status === "Failed");
  const completedJobs = jobs.filter((job) => job.status === "Done");
  const [retried, setRetried] = useState<Set<string>>(new Set());
  const [confirmingFull, setConfirmingFull] = useState(false);
  const pilotActionLabel = `Queue pilot set (${pilotCount})`;
  const pilotActionTitle = mode === "unavailable"
    ? "Rendering isn't available on this deployment."
    : `Queues the whole curated pilot set from config/variants_pilot.yaml — every pilot variant, regardless of what's selected on the Design tab. (${pilotCount} variants)`;
  const fullActionLabel = `Render full matrix (${matrixCount})`;
  const fullActionTitle = mode === "unavailable"
    ? "Rendering isn't available on this deployment."
    : `Renders every variant in config/variants.yaml, regardless of what's selected on the Design tab. (${matrixCount} variants)`;
  useEffect(() => {
    if (!confirmingFull) return;
    const timer = setTimeout(() => setConfirmingFull(false), 8000);
    return () => clearTimeout(timer);
  }, [confirmingFull]);
  const elapsed = (job: QueueJob) => job.startedAt ? (Date.now() - new Date(job.startedAt).getTime()) / 1000 : 0;
  const activeCopy = (job: QueueJob) => {
    if (mode === "local") {
      return job.status === "Queued" ? queueAheadLabel(queuedJobsAhead(job.id, jobs)) : "Worker is rendering";
    }
    return job.status === "Rendering"
      ? `${renderEstimate(stats.medianRenderSeconds, stats.sampleSize, elapsed(job))} left`
      : stats.sampleSize ? `Typically ${renderEstimate(stats.medianRenderSeconds, stats.sampleSize)} once started` : renderEstimate(null, 0);
  };
  const renderingCount = activeJobs.filter((job) => job.status === "Rendering").length;
  const queuedCount = activeJobs.filter((job) => job.status === "Queued").length;
  const summary = activeJobs.length
    ? [
      renderingCount ? `${renderingCount} rendering` : "",
      queuedCount ? `${queuedCount} queued` : "",
      mode === "dispatch" ? `${renderEstimate(stats.medianRenderSeconds, stats.sampleSize, Math.max(...activeJobs.map(elapsed), 0))} remaining` : "",
    ].filter(Boolean).join(" · ")
    : "Queue idle";
  const row = (job: QueueJob) => {
    const done = job.status === "Done";
    const variant = done ? knownVariantId(job.variantId, variants) : null;
    const content = <><span className={`status-dot ${job.status.toLowerCase()}`} /><div className="queue-body"><div className="queue-name">{job.variantId}</div><div className="queue-sub" title={job.error}>{done ? variant ? "Master ready · Open in Library ›" : "Masters ready · Open Library ›" : job.status === "Failed" ? job.error ?? "Render failed" : activeCopy(job)}</div>{job.status === "Failed" && <div className="queue-actions">{job.logsUrl && <a href={job.logsUrl} target="_blank" rel="noopener" className="queue-link">View logs</a>}{mode !== "unavailable" && <button type="button" className="queue-link" disabled={queueing || retried.has(job.id)} onClick={async () => { if (await onRetry(job)) setRetried((old) => new Set(old).add(job.id)); }}>{retried.has(job.id) ? "Retried ✓" : "Retry"}</button>}</div>}</div><time className="queue-time">{relativeTime(job.queuedAt)}</time></>;
    return done ? <button type="button" key={job.id} className="queue-item queue-link-row" onClick={() => onDone(job)}>{content}</button> : <div key={job.id} className="queue-item">{content}</div>;
  };
  const group = (title: string, entries: QueueJob[], empty: string) => <section className="queue-group"><div className="section-title">{title}</div><div className="soft-card queue-card">{entries.length === 0 ? <div className="empty-state">{empty}</div> : entries.map(row)}</div></section>;
  return (
    <section className="panel-section">
      <div className="panel-heading">
        <div><div className="queue-heading-line"><h2>Render queue</h2><span className="mode-chip">{mode === "dispatch" ? "GitHub Actions" : mode === "local" ? "Local worker" : "Browse only"}</span></div><p className="queue-summary" aria-live="polite">{summary}</p></div>
        <div className="panel-heading-actions"><button type="button" onClick={onRefresh} disabled={refreshing} aria-busy={refreshing} className={`round-action ${refreshing ? "is-refreshing" : ""}`} aria-label="Refresh queue"><RefreshCw size={14} /></button></div>
      </div>
      {failedJobs.length > 0 && group("Needs attention", failedJobs, "Nothing needs attention")}
      {group("Active", activeJobs, "No active renders — open Start renders below")}
      {group("Completed today", completedJobs, "No completed renders yet")}
      <details className="start-renders">
        <summary>Start renders <span>· pilot ({pilotCount}) or full matrix ({matrixCount})</span></summary>
        <div className="bulk-actions">
          <div className="bulk-action">
            <button type="button" onClick={onQueuePilot} disabled={mode === "unavailable" || queueing} className="queue-secondary" title={pilotActionTitle} aria-label={pilotActionTitle}><Layers size={14} /> {pilotActionLabel}</button>
            <p className="bulk-action-caption">All {pilotCount} pilot variants, ignores Design selection</p>
          </div>
          <div className="bulk-action">
            {confirmingFull ? (
              <div className="bulk-confirm">
                <button type="button" onClick={() => { setConfirmingFull(false); onQueueFull(); }} disabled={queueing} className="queue-primary" aria-label={`Confirm rendering all ${matrixCount} variants`}>Confirm {matrixCount} renders</button>
                <button type="button" onClick={() => setConfirmingFull(false)} className="queue-secondary">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmingFull(true)} disabled={mode === "unavailable" || matrixCount === 0 || queueing} className="queue-secondary" title={fullActionTitle} aria-label={fullActionTitle}><Grid3x3 size={14} /> {fullActionLabel}</button>
            )}
            <p className="bulk-action-caption">{confirmingFull ? `Tap confirm to dispatch all ${matrixCount} renders.` : `All ${matrixCount} variants, ignores Design selection`}</p>
          </div>
        </div>
        <p className="queue-note">{QUEUE_NOTES[mode]}</p>
      </details>
    </section>
  );
}
