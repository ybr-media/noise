import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { ARTIFACTS_ARE_REMOTE, artifactUrl } from "@/lib/artifacts";
import { audioAsset } from "@/lib/library";
import { RENDER_DIR } from "@/lib/config";
import { verifyDownloadToken } from "@/lib/download-token";
import { DEMO_FILENAME } from "@/lib/demo";

export const dynamic = "force-dynamic";

function gone(): Response {
  const base = process.env.NOISE_APP_URL?.trim() || process.env.AUTH_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return new Response(`Download link expired or invalid. Open the Library: ${base}/#library`, { status: 410, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const verified = verifyDownloadToken(token);
  if (!verified) return gone();
  const asset = await audioAsset(verified.filename);
  if (!asset?.exists || !asset.isMaster) return gone();
  if (verified.filename !== DEMO_FILENAME && ARTIFACTS_ARE_REMOTE) return Response.redirect(artifactUrl(verified.filename), 307);
  const filePath = verified.filename === DEMO_FILENAME ? path.resolve(process.cwd(), "demo", DEMO_FILENAME) : path.join(RENDER_DIR, verified.filename);
  try {
    const stat = fs.statSync(filePath);
    return new Response(fs.createReadStream(filePath) as unknown as BodyInit, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${verified.filename.replace(/["\\\r\n]/g, "_")}"`,
      },
    });
  } catch {
    return gone();
  }
}
