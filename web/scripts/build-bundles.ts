import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadVariants } from "../lib/config";
import { bundleArchiveFilename, bundleNaming } from "../lib/bundle-naming";
import { presets } from "../lib/releases";
import { streamZip, type ZipEntry } from "../lib/zip";
import type { LibraryTrack, Release, TrackStem, Variant } from "../lib/types";

type ReleaseDocument = { releases?: unknown };
type ManifestDocument = { artifacts?: unknown };
type BundleRecord = { variantId: string; renderKey: string; filename: string; sizeBytes: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function readReleases(filePath: string): Release[] {
  try {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8")) as ReleaseDocument;
    return Array.isArray(document.releases) ? document.releases.filter(isRecord) as Release[] : [];
  } catch {
    return [];
  }
}

async function remoteReleases(baseUrl: string): Promise<Release[]> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/releases.json`, { cache: "no-store" });
    if (!response.ok) return [];
    const document = await response.json() as ReleaseDocument;
    return Array.isArray(document.releases) ? document.releases.filter(isRecord) as Release[] : [];
  } catch {
    return [];
  }
}

function mergeReleases(local: Release[], published: Release[]): Release[] {
  const releases = new Map(published.filter((release) => typeof release.id === "string").map((release) => [release.id, release]));
  local.filter((release) => typeof release.id === "string").forEach((release) => releases.set(release.id, release));
  return [...releases.keys()].sort().map((id) => releases.get(id)!);
}

function sidecar(outputDir: string, filename: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(outputDir, filename.replace(/\.wav$/, ".json")), "utf8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isMasterFilename(filename: string): boolean {
  return /^[\w.-]+_master\.wav$/.test(filename);
}

function renderKeyOf(filename: string): string {
  return isMasterFilename(filename) ? filename.slice(0, -"_master.wav".length) : filename.replace(/\.wav$/, "");
}

function stemAssets(outputDir: string, masterSidecar: Record<string, unknown>): TrackStem[] {
  const names = Array.isArray(masterSidecar.stem_filenames) ? masterSidecar.stem_filenames : [];
  return names.flatMap((value, position) => {
    if (typeof value !== "string" || !fs.existsSync(path.join(outputDir, value))) return [];
    return [{
      filename: value,
      sizeBytes: fs.statSync(path.join(outputDir, value)).size,
      number: position + 1,
      stem: `stem_${position + 1}`,
      audioUrl: "",
      downloadUrl: "",
      exists: true,
    }];
  });
}

function namingTrack(variant: Variant, filename: string, sizeBytes: number, metadata: Record<string, unknown>): LibraryTrack {
  return {
    ...variant,
    color: (typeof metadata.color === "string" ? metadata.color : variant.color) as LibraryTrack["color"],
    renderKey: renderKeyOf(filename),
    filename,
    path: filename,
    sizeBytes,
    audioUrl: "",
    downloadUrl: "",
    exists: true,
    stems: [],
    qaVerdict: "UNAVAILABLE",
    qaChecks: [],
    measuredLufs: null,
    measuredTruePeak: null,
    renderStatus: "Done",
    renderedAt: typeof metadata.render_timestamp === "string" ? metadata.render_timestamp : null,
    recipe: {} as LibraryTrack["recipe"],
    title: typeof metadata.seo_title === "string" ? metadata.seo_title : undefined,
    titleApproved: metadata.seo_title_approved === true,
  };
}

function localTracks(outputDir: string, variantsById: Map<string, Variant>): LibraryTrack[] {
  const tracks: LibraryTrack[] = [];
  for (const filename of fs.readdirSync(outputDir).filter((entry) => entry.endsWith(".wav")).sort()) {
    const metadata = sidecar(outputDir, filename);
    if (!metadata || metadata.role !== "master" || !isMasterFilename(filename)) continue;
    const variantId = typeof metadata.variant_id === "string" ? metadata.variant_id : "";
    const variant = variantsById.get(variantId);
    if (!variant) continue;
    const track = namingTrack(variant, filename, fs.statSync(path.join(outputDir, filename)).size, metadata);
    track.stems = stemAssets(outputDir, metadata);
    tracks.push(track);
  }
  return tracks;
}

async function publishedTracks(baseUrl: string, variants: Variant[], variantsById: Map<string, Variant>): Promise<LibraryTrack[]> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/manifest.json`, { cache: "no-store" });
    if (!response.ok) return [];
    const document = await response.json() as ManifestDocument;
    if (!Array.isArray(document.artifacts)) return [];
    const byFilename = new Map(variants.map((variant) => [variant.filename, variant]));
    return document.artifacts.flatMap((value) => {
      if (!isRecord(value) || typeof value.filename !== "string" || !value.filename.endsWith(".wav")) return [];
      const metadata = isRecord(value.sidecar) ? value.sidecar : {};
      const variantId = typeof metadata.variant_id === "string" ? metadata.variant_id : "";
      const variant = variantsById.get(variantId) ?? byFilename.get(value.filename);
      if (!variant || (!isMasterFilename(value.filename) && value.filename !== variant.filename)) return [];
      const sizeBytes = typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes) ? value.sizeBytes : 0;
      return [namingTrack(variant, value.filename, sizeBytes, metadata)];
    });
  } catch {
    return [];
  }
}

function namingReleases(saved: Release[], tracks: LibraryTrack[]): Release[] {
  const savedIds = new Set(saved.map((release) => release.id));
  return [
    ...saved,
    ...presets(tracks)
      .filter((release) => !savedIds.has(release.id))
      .map((release) => ({ ...release, unsaved: true })),
  ];
}

export async function buildBundles(outputDir: string): Promise<BundleRecord[]> {
  const variants = loadVariants();
  const variantsById = new Map(variants.map((variant) => [variant.variantId, variant]));
  const releasesPath = path.join(outputDir, "releases.json");
  const localReleases = fs.existsSync(releasesPath) ? readReleases(releasesPath) : [];
  const baseUrl = process.env.NOISE_ARTIFACTS_BASE_URL;
  const [published, remoteTracks] = baseUrl
    ? await Promise.all([remoteReleases(baseUrl), publishedTracks(baseUrl, variants, variantsById)])
    : [[], []];
  const tracksByRenderKey = new Map(remoteTracks.map((track) => [track.renderKey, track]));
  const local = localTracks(outputDir, variantsById);
  for (const track of local) tracksByRenderKey.set(track.renderKey, track);
  const releases = namingReleases(mergeReleases(localReleases, published), [...tracksByRenderKey.values()]);
  const records: BundleRecord[] = [];
  for (const track of local) {
    const entries: ZipEntry[] = [
      {
        name: bundleNaming(track, releases).masterPath,
        sizeBytes: track.sizeBytes,
        data: (async function* () { yield* fs.createReadStream(path.join(outputDir, track.filename)) as AsyncIterable<Uint8Array>; })(),
      },
      ...track.stems.map((stem) => ({
        name: bundleNaming(track, releases).stemsPath(stem),
        sizeBytes: stem.sizeBytes,
        data: (async function* () { yield* fs.createReadStream(path.join(outputDir, stem.filename)) as AsyncIterable<Uint8Array>; })(),
      })),
    ];
    const archiveFilename = bundleArchiveFilename(track, releases);
    const archivePath = path.join(outputDir, archiveFilename);
    await pipeline(
      Readable.fromWeb(streamZip(entries) as unknown as import("node:stream/web").ReadableStream<Uint8Array>),
      fs.createWriteStream(archivePath),
    );
    records.push({ variantId: track.variantId, renderKey: track.renderKey, filename: archiveFilename, sizeBytes: fs.statSync(archivePath).size });
  }
  fs.writeFileSync(path.join(outputDir, "bundles.json"), `${JSON.stringify({ bundles: records }, null, 2)}\n`);
  return records;
}

async function main(): Promise<void> {
  const outputDir = process.argv[2];
  if (!outputDir || !fs.statSync(outputDir).isDirectory()) throw new Error(`No such output directory: ${outputDir}`);
  const bundles = await buildBundles(outputDir);
  console.log(`Built ${bundles.length} bundle archive(s) in ${outputDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
