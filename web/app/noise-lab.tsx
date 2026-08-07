"use client";

import {
  AlertCircle,
  Check,
  Download,
  Layers,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryTrack, QueueJob, Variant } from "@/lib/types";

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
    <div className="grid gap-1 rounded-lg bg-[#e9e9eb] p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
      {options.map(([id, name]) => (
        <button key={id} type="button" onClick={() => onChange(id)} aria-checked={value === id} role="radio"
          className={`rounded-md px-1.5 py-1.5 text-[11px] font-medium transition ${value === id ? "bg-white text-[#1c1c1e] shadow-sm" : "text-[#8e8e93]"}`}>
          {name}
        </button>
      ))}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-center gap-3 border-t border-[#d8d8dc] px-4 py-3.5 first:border-t-0">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        <div className="mt-0.5 text-[10px] text-[#8e8e93]">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function Toast({ message, error, onClose }: { message: string; error?: boolean; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-4 right-4 z-30 mx-auto flex max-w-md items-start gap-2.5 rounded-2xl px-4 py-3 shadow-2xl" style={{ background: error ? C.accent : C.label }}>
      {error ? <AlertCircle size={17} color="#fff" /> : <Check size={17} color="#fff" />}
      <span className="flex-1 text-sm leading-5 text-white">{message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss"><X size={16} color="#fff" /></button>
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
    canvas.height = 120 * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const width = canvas.clientWidth;
    ctx.strokeStyle = "#e9e9eb";
    ctx.lineWidth = 1;
    for (let y = 20; y < 110; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    if (!analyser || !playing) return;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#ff3b30");
    gradient.addColorStop(0.45, "#ff9500");
    gradient.addColorStop(1, "#007aff");
    let frame = 0;
    const draw = () => {
      analyser.getByteFrequencyData(bins);
      ctx.clearRect(0, 0, width, 120);
      ctx.strokeStyle = "#e9e9eb";
      for (let y = 20; y < 110; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const maxBin = Math.min(bins.length, 512);
      for (let x = 0; x < width; x += 2) {
        const bin = Math.min(maxBin - 1, Math.floor((x / width) * maxBin));
        const y = 108 - (bins[bin] / 255) * 94;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser, playing]);
  return <canvas ref={ref} className="block h-[120px] w-full" aria-label="Approximate preview spectrum" />;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
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
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [tab, setTab] = useState<"design" | "library" | "queue">("design");
  const [selection, setSelection] = useState({ color: "white", band: "mid", motion: "drift", balance: "balanced" });
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const selected = useMemo(() => variants.find((variant) => variant.color === selection.color && variant.band === selection.band && variant.motion === selection.motion && variant.balance === selection.balance), [selection, variants]);
  const preview = useApproxPreview(selected);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [variantResponse, libraryResponse, queueResponse] = await Promise.all([fetch("/api/variants"), fetch("/api/library"), fetch("/api/queue")]);
      setVariants((await variantResponse.json()).variants);
      setTracks((await libraryResponse.json()).tracks);
      setJobs((await queueResponse.json()).jobs);
    } catch { setToast({ message: "Could not load engine data.", error: true }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function queue(ids: string[], label: string) {
    const response = await fetch("/api/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(label === "pilot" ? { pilot: true } : { variantIds: ids }) });
    if (!response.ok) {
      const reason = (await response.json().catch(() => ({}))) as { error?: string };
      setToast({ message: reason.error ?? "Queue request failed.", error: true });
      return;
    }
    setToast({ message: label === "pilot" ? "Pilot set added to the worker queue." : "Variant added to the worker queue." });
    await refresh();
  }

  return (
    <main className="min-h-screen w-full" style={{ background: C.page, fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif' }}>
      <div className="mx-auto w-full max-w-lg px-4 pb-16 pt-8">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-[32px] font-bold tracking-[-0.024em]">Noise Lab</h1>
            <p className="mt-0.5 text-sm tracking-[-0.01em] text-[#8e8e93]">Design a variant, review masters, queue the worker.</p>
          </div>
          <button type="button" onClick={() => void refresh()} aria-label="Refresh" className="rounded-full p-2 text-[#8e8e93] hover:bg-white"><RefreshCw size={19} /></button>
        </header>

        <div className="mt-5 grid grid-cols-3 rounded-xl bg-[#e9e9eb] p-0.5">
          {(["design", "library", "queue"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setTab(item)} className={`rounded-[10px] py-2 text-[13px] font-medium capitalize ${tab === item ? "bg-white text-[#1c1c1e] shadow-sm" : "text-[#8e8e93]"}`}>{item}</button>
          ))}
        </div>

        {tab === "design" && selected && (
          <>
            <section className="mt-5 rounded-2xl bg-white px-4 pb-3 pt-5 shadow-sm">
              <Spectrum analyser={preview.analyser} playing={preview.playing} />
              <div className="mt-2 flex justify-between font-mono text-[10px] text-[#8e8e93]"><span>30 Hz</span><span>500</span><span>2k</span><span>16k</span></div>
              <div className="mt-3 rounded-lg bg-[#f2f2f7] px-3 py-2 text-[11px] text-[#8e8e93]"><strong className="text-[#1c1c1e]">Approximate preview</strong> · WebAudio audition only; the Audacity-rendered master is the source of truth.</div>
            </section>
            <div className="mt-6 flex flex-col items-center">
              <button type="button" onClick={preview.toggle} aria-label={preview.playing ? "Stop approximate preview" : "Play approximate preview"} className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[#ff3b30] text-white shadow-lg transition active:scale-95">
                {preview.playing ? <Pause size={27} fill="white" strokeWidth={0} /> : <Play size={27} fill="white" strokeWidth={0} className="ml-1" />}
              </button>
              <div className="mt-3.5 flex items-center gap-2 font-mono text-xs text-[#8e8e93]">
                <span>Matrix {selected.matrixIndex} of 144</span>
                {selected.pilot && <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-[#ff3b30]">Pilot {selected.pilot}</span>}
              </div>
            </div>
            <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
              <Row label="Color" hint={selected.spectrum.bell ? "+6 dB bell @ 500 Hz" : `${selected.spectrum.tiltDbPerOct} dB/oct`}><Segmented options={OPTIONS.color} value={selection.color} onChange={(value) => setSelection((old) => ({ ...old, color: value }))} label="Color" /></Row>
              <Row label="Band" hint={`${selected.band} texture`}><Segmented options={OPTIONS.band} value={selection.band} onChange={(value) => setSelection((old) => ({ ...old, band: value }))} label="Band" /></Row>
              <Row label="Motion" hint={`${selected.motion} modulation`}><Segmented options={OPTIONS.motion} value={selection.motion} onChange={(value) => setSelection((old) => ({ ...old, motion: value }))} label="Motion" /></Row>
              <Row label="Balance" hint={`${selected.balance} mix`}><Segmented options={OPTIONS.balance} value={selection.balance} onChange={(value) => setSelection((old) => ({ ...old, balance: value }))} label="Balance" /></Row>
            </section>
            <section className="mt-5 rounded-2xl bg-white px-4 py-4 shadow-sm">
              <div className="break-all font-mono text-xs leading-5">{selected.variantId}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#8e8e93]"><span>Duration <strong className="text-[#1c1c1e]">{formatDuration(selected.durationSeconds)}</strong></span><span>Seed <strong className="font-mono text-[#1c1c1e]">{selected.seeds.bed_l}</strong></span></div>
              <button type="button" onClick={() => void queue([selected.variantId], "one")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#ff3b30] py-3 text-[15px] font-semibold text-white"><Layers size={17} /> Queue this render</button>
              <button type="button" onClick={() => void queue([], "pilot")} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#e9e9eb] py-3 text-[15px] font-medium"><Layers size={17} /> Queue pilot set</button>
            </section>
          </>
        )}

        {tab === "library" && <Library tracks={tracks} loading={loading} onRefresh={() => void refresh()} onToast={setToast} />}
        {tab === "queue" && <Queue jobs={jobs} onRefresh={() => void refresh()} />}
      </div>
      {toast && <Toast message={toast.message} error={toast.error} onClose={() => setToast(null)} />}
    </main>
  );
}

function Library({ tracks, loading, onRefresh, onToast }: { tracks: LibraryTrack[]; loading: boolean; onRefresh: () => void; onToast: (toast: { message: string; error?: boolean }) => void }) {
  return (
    <section className="mt-5">
      <div className="mb-3 flex items-center justify-between px-1"><div><h2 className="text-[20px] font-bold">Library</h2><p className="text-xs text-[#8e8e93]">Rendered masters and QA evidence</p></div><button type="button" onClick={onRefresh} className="rounded-full bg-[#e9e9eb] p-2 text-[#1c1c1e]" aria-label="Refresh library"><RefreshCw size={14} /></button></div>
      <div className="mb-3 rounded-xl bg-white px-4 py-3 text-xs shadow-sm"><div className="font-medium">{tracks.filter((track) => track.exists).length} of {tracks.length} variants rendered</div><div className="mt-1 break-all font-mono text-[10px] text-[#8e8e93]">Reading {tracks[0]?.path.replace(/\/[^/]+$/, "") ?? "configured render directory"}</div></div>
      <div className="space-y-3">
        {loading && <div className="rounded-2xl bg-white p-6 text-center text-sm text-[#8e8e93]">Loading render directory…</div>}
        {!loading && tracks.filter((track) => track.exists).length === 0 && <div className="rounded-2xl bg-white p-6 text-center text-sm text-[#8e8e93]">No rendered files found in the directory above.</div>}
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
    setCandidate((current) => current + 1);
    setBusy(true);
    const response = await fetch("/api/names/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variantId: track.variantId, candidate: candidate + 1 }) });
    const payload = await response.json();
    setSuggestion(payload.suggestion);
    setBusy(false);
  }
  async function approve() {
    if (!suggestion) return;
    setBusy(true);
    const response = await fetch("/api/names/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: track.filename, title: suggestion.title, description: suggestion.description }) });
    setBusy(false);
    onToast(response.ok ? { message: "Name approved in sidecar metadata." } : { message: "Could not approve name.", error: true });
  }
  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-mono text-[11px]">{track.variantId}</div>{track.title && <div className="mt-1 truncate text-sm font-semibold">{track.title}{track.titleApproved && <span className="ml-1 text-[10px] font-normal text-[#34c759]">approved</span>}</div>}<div className="mt-1 text-[12px] text-[#8e8e93]">Matrix {track.matrixIndex} · {formatDuration(track.durationSeconds)} · {track.color} / {track.band} / {track.motion}</div></div><span className={`rounded-full px-2 py-1 font-mono text-[10px] font-semibold ${track.qaVerdict === "PASS" ? "bg-green-50 text-[#34c759]" : track.qaVerdict === "FAIL" ? "bg-red-50 text-[#ff3b30]" : "bg-gray-100 text-[#8e8e93]"}`}>{track.qaVerdict}</span></div>
        <audio className="mt-3 w-full" controls preload="none" src={track.audioUrl} />
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#f2f2f7] p-3 text-xs"><div><span className="text-[#8e8e93]">LUFS</span><div className="mt-0.5 font-mono font-semibold">{track.measuredLufs ?? "—"}</div></div><div><span className="text-[#8e8e93]">True peak</span><div className="mt-0.5 font-mono font-semibold">{track.measuredTruePeak ?? "—"}</div></div></div>
        <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-[#007aff]">Show QA checks</summary><div className="mt-2 space-y-1">{track.qaChecks.map((check) => <div key={check.name} className="flex justify-between gap-2 border-t border-[#d8d8dc] py-1.5 text-[11px]"><span>{check.passed ? "✓" : "×"} {check.name}</span><span className="font-mono text-[#8e8e93]">{check.measured}</span></div>)}</div></details>
        <div className="mt-3 flex gap-2"><a href={track.downloadUrl} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#e9e9eb] py-2.5 text-xs font-medium"><Download size={14} /> Download WAV</a><button type="button" onClick={() => void generate()} disabled={busy} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1c1c1e] py-2.5 text-xs font-medium text-white"><Sparkles size={14} /> {busy ? "Thinking…" : "Suggest SEO name"}</button></div>
        {suggestion && <div className="mt-3 rounded-xl border border-[#d8d8dc] p-3"><div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#8e8e93]">Review before approval</div><input value={suggestion.title} onChange={(event) => setSuggestion({ ...suggestion, title: event.target.value })} className="w-full border-b border-[#d8d8dc] pb-1 text-sm font-semibold outline-none" /><textarea value={suggestion.description} onChange={(event) => setSuggestion({ ...suggestion, description: event.target.value })} className="mt-2 h-16 w-full resize-none text-xs leading-4 outline-none" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => void regenerate()} className="rounded-lg px-2 py-1.5 text-xs text-[#007aff]">Regenerate</button><button type="button" onClick={() => void approve()} className="rounded-lg bg-[#34c759] px-3 py-1.5 text-xs font-semibold text-white">Approve</button></div></div>}
      </div>
    </article>
  );
}

function Queue({ jobs, onRefresh }: { jobs: QueueJob[]; onRefresh: () => void }) {
  return <section className="mt-5"><div className="mb-3 flex items-center justify-between px-1"><div><h2 className="text-[20px] font-bold">Render queue</h2><p className="text-xs text-[#8e8e93]">Honest worker-backed status</p></div><button type="button" onClick={onRefresh} className="rounded-full bg-[#e9e9eb] p-2" aria-label="Refresh queue"><RefreshCw size={14} /></button></div><div className="overflow-hidden rounded-2xl bg-white shadow-sm">{jobs.length === 0 ? <div className="p-8 text-center text-sm text-[#8e8e93]">No jobs queued.</div> : jobs.map((job, index) => <div key={job.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${index ? "border-t border-[#d8d8dc]" : ""}`}><div className="min-w-0"><div className="truncate font-mono text-[11px]">{job.variantId}</div><div className="mt-0.5 text-[11px] text-[#8e8e93]">{new Date(job.queuedAt).toLocaleString()}</div></div><span className="rounded-full bg-[#f2f2f7] px-2 py-1 font-mono text-[10px]">{job.status}</span></div>)}</div><p className="mt-3 px-1 text-xs leading-5 text-[#8e8e93]">Queueing writes a JSONL job for the separate Python worker. This console does not pretend that Audacity renders complete inside an HTTP request.</p></section>;
}
