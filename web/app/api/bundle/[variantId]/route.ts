import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { RENDER_DIR } from "@/lib/config";
import { ARTIFACTS_ARE_REMOTE, artifactUrl } from "@/lib/artifacts";
import { bundleAssets } from "@/lib/library";
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
  const entries: ZipEntry[] = assets.map((asset) => ({
    name: asset.filename,
    sizeBytes: asset.sizeBytes,
    data: (async function* () { yield* await source(asset.filename); })(),
  }));
  return new Response(streamZip(entries), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${variantId}.zip"`,
    },
  });
}
