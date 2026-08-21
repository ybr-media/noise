import { NextRequest } from "next/server";
import { resolveCurrentUser } from "@/lib/me";
import { libraryTracks } from "@/lib/library";
import { buildRenderEmail } from "@/lib/render-email";
import { signDownloadToken, signUnsubscribeToken } from "@/lib/download-token";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const resolved = await resolveCurrentUser();
  if ("response" in resolved) return resolved.response;
  const key = request.nextUrl.searchParams.get("renderKey");
  const track = (await libraryTracks()).find((candidate) => candidate.renderKey === key && candidate.exists);
  if (!track) return new Response("Track not found", { status: 404 });
  const base = process.env.NOISE_APP_URL?.trim() || process.env.AUTH_URL?.trim() || `http://localhost:${process.env.PORT ?? "3000"}`;
  const download = `${base}/api/download/${signDownloadToken(track.filename, Date.now() + 14 * 24 * 60 * 60 * 1000)}`;
  const email = buildRenderEmail({
    tracks: [track],
    appUrl: base,
    finishedAt: track.renderedAt ?? new Date().toISOString(),
    downloadUrls: { [track.renderKey]: download },
    unsubscribeUrl: `${base}/api/notifications/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(resolved.email))}`,
  });
  return new Response(email.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
