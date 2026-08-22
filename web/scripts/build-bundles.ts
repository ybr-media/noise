import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadVariants } from "../lib/config";
import { bundleArchiveFilename, bundleNaming } from "../lib/bundle-naming";
import { streamZip, type ZipEntry } from "../lib/zip";
import type { LibraryTrack, Release, TrackStem, Variant } from "../lib/types";

type ReleaseDocument = { releases?: unknown };
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
  return [...releases.values()];
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

function namingTrack(outputDir: string, variant: Variant, filename: string, metadata: Record<string, unknown>): LibraryTrack {
  return {
    ...variant,
    color: (typeof metadata.color === "string" ? metadata.color : variant.color) as LibraryTrack["color"],
    renderKey: renderKeyOf(filename),
    filename,
    path: filename,
    sizeBytes: fs.statSync(path.join(outputDir, filename)).size,
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

export async function buildBundles(outputDir: string): Promise<BundleRecord[]> {
  const variants = loadVariants();
  const variantsById = new Map(variants.map((variant) => [variant.variantId, variant]));
  const releasesPath = path.join(outputDir, "releases.json");
  const local = fs.existsSync(releasesPath) ? readReleases(releasesPath) : [];
  const published = process.env.NOISE_ARTIFACTS_BASE_URL
    ? await remoteReleases(process.env.NOISE_ARTIFACTS_BASE_URL)
    : [];
  const releases = mergeReleases(local, published);
  const records: BundleRecord[] = [];
  for (const filename of fs.readdirSync(outputDir).filter((entry) => entry.endsWith(".wav")).sort()) {
    const metadata = sidecar(outputDir, filename);
    if (!metadata || metadata.role !== "master" || !isMasterFilename(filename)) continue;
    const variantId = typeof metadata.variant_id === "string" ? metadata.variant_id : "";
    const variant = variantsById.get(variantId);
    if (!variant) continue;
    const track = namingTrack(outputDir, variant, filename, metadata);
    track.stems = stemAssets(outputDir, metadata);
    const entries: ZipEntry[] = [
      {
        name: bundleNaming(track, releases).masterPath,
        sizeBytes: track.sizeBytes,
        data: (async function* () { yield* fs.createReadStream(path.join(outputDir, filename)) as AsyncIterable<Uint8Array>; })(),
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
    records.push({ variantId, renderKey: track.renderKey, filename: archiveFilename, sizeBytes: fs.statSync(archivePath).size });
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
