import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { RENDER_DIR } from "@/lib/config";
import { ARTIFACTS_ARE_REMOTE, artifactUrl } from "@/lib/artifacts";
import { bundleAssets } from "@/lib/library";
import { bundleNaming } from "@/lib/bundle-naming";
import { releaseList } from "@/lib/releases";
import { streamZip, type ZipEntry } from "@/lib/zip";

export const dynamic = "force-dynamic";

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
  const names = bundleNaming(assets.master, await releaseList());
  const date = assets.master.renderedAt ? new Date(assets.master.renderedAt) : undefined;
  const entries: ZipEntry[] = [
    { name: names.masterPath, sizeBytes: assets.master.sizeBytes, date, data: (async function* () { yield* await source(assets.master.filename); })() },
    ...assets.stems.map((stem) => ({ name: names.stemsPath(stem), sizeBytes: stem.sizeBytes, date, data: (async function* () { yield* await source(stem.filename); })() })),
  ];
  const asciiFilename = names.zipFilename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\\r\n]/g, "_");
  const encodedFilename = encodeURIComponent(names.zipFilename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(streamZip(entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
    },
  });
}
