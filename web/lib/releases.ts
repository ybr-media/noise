import fs from "node:fs";
import path from "node:path";
import { ARTIFACTS_BASE_URL } from "./artifacts";
import { DISPATCH_CONFIGURED, dispatchMetadata } from "./dispatch";
import { dimensionValues, loadPilotVariants, loadVariants, RENDER_DIR, RENDER_MODE } from "./config";
import { libraryTracks } from "./library";
import { DEFAULT_ARTIST } from "./release-defaults";
import type { Color, LibraryTrack, Release, ReleaseTrack, ReleaseType } from "./types";

export type ReleaseMode = "local" | "dispatch" | "unavailable";
export type ReleaseState = "Draft" | "Named" | "ArtReady" | "Ready" | "Submitted";
export type ReleaseLadder = { named: boolean; art: boolean; ready: boolean; submitted: boolean };
export type DerivedRelease = Release & { state: ReleaseState; blockingItem: string; ladder: ReleaseLadder; unsaved?: boolean };

export const RELEASE_MODE: ReleaseMode = ARTIFACTS_BASE_URL
  ? DISPATCH_CONFIGURED ? "dispatch" : "unavailable"
  : process.env.VERCEL ? (DISPATCH_CONFIGURED ? "dispatch" : "unavailable") : RENDER_MODE;

const RELEASES_NAME = "releases.json";
const TTL_MS = Number(process.env.NOISE_MANIFEST_TTL_MS ?? 30_000);

type ReleaseDocument = { releases?: unknown };
let remoteCache: { releases: Release[]; at: number } | null = null;

function readLocal(): Release[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(RENDER_DIR, RELEASES_NAME), "utf8")) as ReleaseDocument;
    return Array.isArray(parsed.releases) ? parsed.releases as Release[] : [];
  } catch {
    return [];
  }
}

async function readRemote(): Promise<Release[]> {
  if (remoteCache && Date.now() - remoteCache.at < TTL_MS) return remoteCache.releases;
  const response = await fetch(`${ARTIFACTS_BASE_URL}/${RELEASES_NAME}`, { cache: "no-store" });
  const releases = response.ok
    ? ((await response.json()) as ReleaseDocument).releases
    : [];
  remoteCache = { releases: Array.isArray(releases) ? releases as Release[] : [], at: Date.now() };
  return remoteCache.releases;
}

export async function loadReleases(): Promise<Release[]> {
  return ARTIFACTS_BASE_URL ? readRemote() : readLocal();
}

const baseRelease = (id: string, type: ReleaseType, title: string, tracks: ReleaseTrack[]): Release => ({
  id,
  type,
  artist: DEFAULT_ARTIST,
  title,
  genre: "New Age",
  secondaryGenre: "Ambient",
  releaseDate: "",
  artSeed: null,
  songwriter: "",
  tracks,
  submitted: { at: null, storeUrl: null },
});

function presetTracks(variants: ReturnType<typeof loadVariants>, tracks: LibraryTrack[]): ReleaseTrack[] {
  const rendered = new Set(tracks.filter((track) => track.exists).map((track) => track.variantId));
  return variants
    .filter((variant) => rendered.has(variant.variantId))
    .sort((a, b) => a.matrixIndex - b.matrixIndex)
    .map((variant) => ({
      variantId: variant.variantId,
      title: "",
      description: "",
      approvedAt: null,
    }));
}

export function pilotRelease(tracks: LibraryTrack[]): Release {
  return baseRelease("pilot-ep", "ep", "Pilot EP", presetTracks(loadPilotVariants(), tracks));
}

export function colorAlbum(color: Color, tracks: LibraryTrack[]): Release {
  return baseRelease(`${color}-album`, "album", `${color[0].toUpperCase()}${color.slice(1)} Noise`, presetTracks(loadVariants().filter((variant) => variant.color === color), tracks));
}

function presets(tracks: LibraryTrack[]): Release[] {
  return [pilotRelease(tracks), ...dimensionValues("color").map((color) => colorAlbum(color as Color, tracks))].filter((release) => release.tracks.length > 0);
}

function titleState(tracks: ReleaseTrack[]): { missing: number; duplicate: number } {
  const missing = tracks.filter((track) => !track.title.trim()).length;
  const counts = new Map<string, number>();
  tracks.forEach((track) => counts.set(track.title.trim().toLowerCase(), (counts.get(track.title.trim().toLowerCase()) ?? 0) + 1));
  const duplicate = Array.from(counts.values()).filter((count) => count > 1).reduce((total, count) => total + count, 0);
  return { missing, duplicate };
}

function derived(release: Release, tracks: LibraryTrack[]): DerivedRelease {
  const base = (state: ReleaseState, blockingItem: string, ladder: ReleaseLadder): DerivedRelease => ({ ...release, state, blockingItem, ladder });
  if (release.submitted.at) return base("Submitted", "open in store", { named: true, art: true, ready: true, submitted: true });
  const metadataMissing = [
    !release.artist.trim() ? "artist missing" : "",
    !release.songwriter.trim() ? "songwriter missing" : "",
    !release.releaseDate ? "release date missing" : "",
  ].filter(Boolean);
  const names = titleState(release.tracks);
  if (names.missing) return base("Draft", `${names.missing} titles missing`, { named: false, art: false, ready: false, submitted: false });
  if (names.duplicate) return base("Draft", `${names.duplicate} duplicate titles`, { named: false, art: false, ready: false, submitted: false });
  if (release.artSeed === null) return base("Named", "cover art not generated", { named: true, art: false, ready: false, submitted: false });
  const library = new Map(tracks.map((track) => [track.variantId, track]));
  const notRendered = release.tracks.filter((track) => !library.get(track.variantId)?.exists).length;
  if (notRendered) return base("ArtReady", `${notRendered} tracks not rendered`, { named: true, art: true, ready: false, submitted: false });
  const qaFailed = release.tracks.filter((track) => library.get(track.variantId)?.qaVerdict !== "PASS").length;
  if (qaFailed) return base("ArtReady", `${qaFailed} tracks failed QA`, { named: true, art: true, ready: false, submitted: false });
  if (metadataMissing.length) return base("ArtReady", metadataMissing.join(" · "), { named: true, art: true, ready: false, submitted: false });
  return base("Ready", "ready to upload", { named: true, art: true, ready: true, submitted: false });
}

export async function releaseList(): Promise<DerivedRelease[]> {
  const saved = await loadReleases();
  const byId = new Map(saved.map((release) => [release.id, release]));
  const tracks = await libraryTracks();
  const suggestions = presets(tracks).filter((release) => !byId.has(release.id)).map((release) => ({ ...release, unsaved: true }));
  return [...saved.map((release) => derived(release, tracks)), ...suggestions.map((release) => derived(release, tracks))];
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const knownTypes = new Set(["single", "ep", "album"]);
const allowedReleaseKeys = new Set(["id", "type", "artist", "title", "genre", "secondaryGenre", "releaseDate", "artSeed", "songwriter", "tracks", "submitted"]);
const allowedTrackKeys = new Set(["variantId", "title", "description", "approvedAt"]);

export function validateRelease(value: unknown): Release {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A release document is required");
  const object = value as Record<string, unknown>;
  const unknown = Object.keys(object).filter((key) => !allowedReleaseKeys.has(key));
  if (unknown.length) throw new Error(`Unknown release field: ${unknown[0]}`);
  if (typeof object.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(object.id)) throw new Error("Release id must use lowercase letters, numbers, and hyphens");
  if (!knownTypes.has(object.type as string) || typeof object.artist !== "string" || typeof object.title !== "string" || typeof object.genre !== "string" || typeof object.secondaryGenre !== "string" || typeof object.songwriter !== "string") {
    throw new Error("Release metadata is incomplete");
  }
  if (typeof object.releaseDate !== "string" || (object.releaseDate && !isDate(object.releaseDate))) throw new Error("Release date must use YYYY-MM-DD");
  if (object.artSeed !== null && typeof object.artSeed !== "number") throw new Error("artSeed must be a number or null");
  if (!Array.isArray(object.tracks) || !object.tracks.length) throw new Error("At least one release track is required");
  const known = new Set(loadVariants().map((variant) => variant.variantId));
  const tracks = object.tracks.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid release track");
    const track = value as Record<string, unknown>;
    const extra = Object.keys(track).filter((key) => !allowedTrackKeys.has(key));
    if (extra.length) throw new Error(`Unknown release track field: ${extra[0]}`);
    if (typeof track.variantId !== "string" || !known.has(track.variantId)) throw new Error("Release track has an unknown variant");
    if (typeof track.title !== "string" || typeof track.description !== "string" || (track.approvedAt !== null && typeof track.approvedAt !== "string")) throw new Error("Release track metadata is incomplete");
    return { variantId: track.variantId, title: track.title, description: track.description, approvedAt: track.approvedAt as string | null };
  });
  if (!object.submitted || typeof object.submitted !== "object" || Array.isArray(object.submitted)) throw new Error("Submitted metadata is required");
  const submitted = object.submitted as Record<string, unknown>;
  if ((submitted.at !== null && typeof submitted.at !== "string") || (submitted.storeUrl !== null && typeof submitted.storeUrl !== "string")) throw new Error("Submitted metadata is invalid");
  return {
    id: object.id,
    type: object.type as ReleaseType,
    artist: object.artist,
    title: object.title,
    genre: object.genre,
    secondaryGenre: object.secondaryGenre,
    releaseDate: object.releaseDate,
    artSeed: object.artSeed as number | null,
    songwriter: object.songwriter,
    tracks,
    submitted: { at: submitted.at as string | null, storeUrl: submitted.storeUrl as string | null },
  };
}

function mergeReleases(current: Release[], next: Release): Release[] {
  const merged = new Map(current.map((release) => [release.id, release]));
  merged.set(next.id, next);
  return Array.from(merged.values());
}

export async function saveRelease(release: Release): Promise<void> {
  if (RELEASE_MODE === "unavailable") throw new Error("Releases are edited where a writer is configured; this deployment is read-only");
  if (RELEASE_MODE === "dispatch") {
    await dispatchMetadata(JSON.stringify(release));
    return;
  }
  const payload = { releases: mergeReleases(readLocal(), release) };
  const target = path.join(RENDER_DIR, RELEASES_NAME);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

export async function releasePayload(release: Release): Promise<{ release: DerivedRelease; mode: ReleaseMode }> {
  const tracks = await libraryTracks();
  return { release: derived(release, tracks), mode: RELEASE_MODE };
}
