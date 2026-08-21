import { missingAuthEnv, getAuthUserByEmail } from "./auth";
import { isAllowedEmail } from "./allowlist";
import { invalidateArtifactCache } from "./artifacts";
import { libraryTracks } from "./library";
import { sendEmail } from "./email";
import { buildRenderEmail } from "./render-email";
import { signDownloadToken, signUnsubscribeToken } from "./download-token";

export type RenderNotification = {
  kind: "render-complete";
  requestedBy: string;
  renderKeys: string[];
  runId?: string;
  finishedAt: string;
};

function appUrl(): string | null {
  const value = process.env.NOISE_APP_URL?.trim() || process.env.AUTH_URL?.trim()
    || (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : "");
  return value ? value.replace(/\/+$/, "") : null;
}

async function claim(key: string): Promise<boolean> {
  const redisEnv = {
    url: process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim(),
    token: process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim(),
  };
  if (!redisEnv.url || !redisEnv.token) return false;
  const { Redis } = await import("@upstash/redis");
  const redis = new Redis(redisEnv);
  const result = await redis.set(key, "1", { nx: true, ex: 2_592_000 });
  return result === "OK";
}

function skip(reason: string, runId?: string): "skipped" {
  console.log(`[render-email] skipped${runId ? ` runId=${runId}` : ""} reason=${reason}`);
  return "skipped";
}

export async function notifyRenderComplete(notification: RenderNotification): Promise<"sent" | "skipped"> {
  try {
    if (notification.kind !== "render-complete") return skip("invalid-kind", notification.runId);
    if (process.env.NOISE_RENDER_EMAILS === "0") return skip("disabled", notification.runId);
    const requestedBy = notification.requestedBy?.trim().toLowerCase();
    if (!requestedBy) return skip("no-requester", notification.runId);
    if (!isAllowedEmail(requestedBy)) return skip("disallowed-recipient", notification.runId);
    if (!process.env.AUTH_RESEND_KEY?.trim() || !process.env.AUTH_EMAIL_FROM?.trim()) return skip("missing-resend-config", notification.runId);
    if (missingAuthEnv().length > 0) return skip("missing-auth-config", notification.runId);
    const base = appUrl();
    if (!base) return skip("missing-app-url", notification.runId);
    const user = await getAuthUserByEmail(requestedBy);
    if (!user) return skip("user-not-found", notification.runId);
    if ((user as AdapterLike).renderEmails === false) return skip("opted-out", notification.runId);
    const id = notification.runId || `${notification.finishedAt}:${notification.renderKeys.join(",")}`;
    if (!(await claim(`render-notify:${id}`))) return skip("already-notified", notification.runId);
    invalidateArtifactCache();
    const tracks = await libraryTracks();
    const resolved = notification.renderKeys
      .map((renderKey) => tracks.find((track) => track.renderKey === renderKey && track.exists))
      .filter((track): track is NonNullable<typeof track> => Boolean(track));
    if (!resolved.length) return skip("no-resolvable-render-keys", notification.runId);
    const downloadUrls: Record<string, string> = {};
    if (resolved.length === 1) {
      const expiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000;
      downloadUrls[resolved[0].renderKey] = `${base}/api/download/${signDownloadToken(resolved[0].filename, expiresAt)}`;
    }
    const unsubscribeUrl = `${base}/api/notifications/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(requestedBy))}`;
    const email = buildRenderEmail({
      tracks: resolved,
      appUrl: base,
      finishedAt: notification.finishedAt,
      downloadUrls,
      unsubscribeUrl,
    });
    await sendEmail({
      to: requestedBy,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    console.log(`[render-email] sent${notification.runId ? ` runId=${notification.runId}` : ""}`);
    return "sent";
  } catch {
    return skip("error", notification.runId);
  }
}

type AdapterLike = { renderEmails?: boolean };
