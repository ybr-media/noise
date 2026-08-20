import type { LibraryTrack, Release, TrackStem } from "./types";
import { DEFAULT_ARTIST } from "./release-defaults";

type NamingRelease = Release & { unsaved?: boolean };

const clean = (value: string, fallback: string) => {
  const result = value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return result || fallback;
};

const extension = (filename: string) => {
  const match = filename.match(/(\.[^./\\]+)$/);
  return match ? match[1] : "";
};

const releaseFor = (variantId: string, releases: NamingRelease[]) =>
  releases.find((release) => !release.unsaved && release.tracks.some((track) => track.variantId === variantId))
  ?? releases.find((release) => release.tracks.some((track) => track.variantId === variantId));

const version = (color: LibraryTrack["color"]) => `${color[0].toUpperCase()}${color.slice(1)} Noise`;

export type BundleNaming = {
  zipFilename: string;
  masterPath: string;
  stemsPath: (stem: TrackStem) => string;
};

export function bundleNaming(track: LibraryTrack, releases: NamingRelease[]): BundleNaming {
  const release = releaseFor(track.variantId, releases);
  const artist = clean(release?.artist || DEFAULT_ARTIST, DEFAULT_ARTIST);
  const album = clean(release?.title || "Untitled Album", "Untitled Album");
  const releaseTrack = release?.tracks.find((candidate) => candidate.variantId === track.variantId);
  const title = clean(releaseTrack?.title?.trim() || (track.titleApproved ? track.title?.trim() : "") || track.variantId, track.variantId);
  const number = String((release ? release.tracks.findIndex((candidate) => candidate.variantId === track.variantId) : -1) + 1).padStart(2, "0");
  const prefix = `${artist} - ${album} - ${number} - ${title} (${version(track.color)})`;
  const folder = `${artist} - ${album}`;
  const master = `${folder} [Masters]`;
  const stems = `${folder} [Stems]`;
  return {
    zipFilename: `${artist} - ${album} [Masters & Stems].zip`,
    masterPath: `${master}/${prefix} [Master]${extension(track.filename)}`,
    stemsPath: (stem) => `${stems}/${prefix} [Stems]/Stem ${stem.number}${extension(stem.filename)}`,
  };
}

export function bundleArchiveFilename(track: LibraryTrack, releases: NamingRelease[]): string {
  const names = bundleNaming(track, releases);
  const base = names.zipFilename.replace(/\.zip$/i, "");
  return `${base} - ${clean(track.renderKey, track.variantId)}.zip`;
}
