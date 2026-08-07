import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { RENDER_DIR } from "@/lib/config";
import { ARTIFACTS_ARE_REMOTE, artifactUrl } from "@/lib/artifacts";
import { trackForFilename } from "@/lib/library";
import { resolveByteRange } from "@/lib/range";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ filename: string }> }) {
  const { filename } = await context.params;
  const track = await trackForFilename(filename);
  if (!track || !track.exists) return new Response("Audio not found", { status: 404 });
  // Published artifacts are served straight from object storage so multi-hundred
  // megabyte seeks never travel through the console's runtime.
  if (ARTIFACTS_ARE_REMOTE) return Response.redirect(artifactUrl(filename), 307);
  const filePath = path.join(RENDER_DIR, filename);
  const stat = fs.statSync(filePath);
  const range = request.headers.get("range");
  const download = request.nextUrl.searchParams.get("download") === "1";
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": "audio/wav",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
  });
  if (!range) {
    headers.set("Content-Length", String(stat.size));
    return new Response(fs.createReadStream(filePath) as unknown as BodyInit, { headers });
  }
  const resolved = resolveByteRange(range, stat.size);
  if (!resolved) return new Response("Range not satisfiable", { status: 416 });
  const { start, end } = resolved;
  headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(fs.createReadStream(filePath, { start, end }) as unknown as BodyInit, { status: 206, headers });
}
