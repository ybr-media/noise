import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { RENDER_DIR } from "@/lib/config";
import { ARTIFACTS_ARE_REMOTE, artifactIndex, artifactUrl } from "@/lib/artifacts";
import { prebuiltBundleFilename } from "@/lib/bundle-redirect";
import { bundleAssets } from "@/lib/library";
import { bundleArchiveFilename, bundleNaming } from "@/lib/bundle-naming";
import { releaseList } from "@/lib/releases";
import { streamZip, type ZipEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function source(filename: string): Promise<AsyncIterable<Uint8Array>> {
  if (ARTIFACTS_ARE_REMOTE) {
    const response = await fetch(artifactUrl(filename), { cache: "no-store" });
    if (!response.ok || !response.body) throw new Error(`Unable to fetch ${filename}`);
    return Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
  }
  return fs.createReadStream(path.join(RENDER_DIR, filename)) as AsyncIterable<Uint8Array>;
}

export async function GET(_request: Request, context: { params: Promise<{ variantId: string }> }) {
  const { variantId } = await context.params;
  const assets = await bundleAssets(variantId);
  if (!assets) return new Response("Variant not found", { status: 404 });
  const releases = await releaseList();
  const names = bundleNaming(assets.master, releases);
  const archiveFilename = bundleArchiveFilename(assets.master, releases);
  if (ARTIFACTS_ARE_REMOTE) {
    const filename = prebuiltBundleFilename(await artifactIndex(), assets.master.renderKey, archiveFilename);
    if (filename) return Response.redirect(artifactUrl(filename), 307);
  }
  const date = assets.master.renderedAt ? new Date(assets.master.renderedAt) : undefined;
  const entries: ZipEntry[] = [
    { name: names.masterPath, sizeBytes: assets.master.sizeBytes, date, data: (async function* () { yield* await source(assets.master.filename); })() },
    ...assets.stems.map((stem) => ({ name: names.stemsPath(stem), sizeBytes: stem.sizeBytes, date, data: (async function* () { yield* await source(stem.filename); })() })),
  ];
  const asciiFilename = archiveFilename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\\r\n]/g, "_");
  const encodedFilename = encodeURIComponent(archiveFilename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(streamZip(entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
    },
  });
}
