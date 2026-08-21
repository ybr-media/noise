import type { LibraryTrack } from "./types";
import { formatBytes } from "./format";
import { fxBadges } from "./fx";
import { serializeRoute } from "./route";

export type RenderEmailInput = {
  tracks: LibraryTrack[];
  appUrl: string;
  finishedAt: string;
  downloadUrls?: Record<string, string>;
  unsubscribeUrl?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function appBase(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}

function displayTitle(track: LibraryTrack): string {
  return track.title?.trim() || track.renderKey;
}

function duration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function sampleRate(sampleRate: number | null | undefined, bitDepth: number | null | undefined): string | null {
  if (sampleRate === null || sampleRate === undefined || bitDepth === null || bitDepth === undefined) return null;
  return `${Math.round(sampleRate / 1000)} kHz/${bitDepth}-bit`;
}

function loudness(value: string | null | undefined): string | null {
  if (!value) return null;
  return /LUFS/i.test(value) ? value : `${value} LUFS`;
}

export function renderTrackFacts(track: LibraryTrack): string[] {
  const facts = [duration(track.durationSeconds), sampleRate(track.sampleRate, track.recipe.bitDepth), loudness(track.measuredLufs)];
  if (track.qaVerdict === "PASS") facts.push("QA passed");
  else if (track.qaVerdict === "FAIL") facts.push("QA flagged — see checks");
  else facts.push("QA not run");
  return facts.filter((fact): fact is string => Boolean(fact));
}

export function renderFxSummary(track: LibraryTrack): string {
  const recipe = track.recipe;
  const badges = fxBadges({ eq: recipe.eq ?? undefined, reverb: recipe.reverb ?? undefined });
  return badges.join(" · ") || "EQ: Flat";
}

function libraryUrl(appUrl: string, renderKey?: string): string {
  return `${appBase(appUrl)}/${serializeRoute({ tab: "library", ...(renderKey === undefined ? {} : { trackId: renderKey }), activity: false })}`;
}

function heroUrl(appUrl: string, renderKey: string): string {
  return `${appBase(appUrl)}/api/og/track/${encodeURIComponent(renderKey)}`;
}

export function renderEmailSubject(tracks: LibraryTrack[]): string {
  if (tracks.length === 1) return `${displayTitle(tracks[0])} is rendered`;
  return `${tracks.length} tracks are rendered`;
}

function headerMarkup(appUrl: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><div style="width:56px;height:56px;border-radius:50%;background:#ffdc4a;line-height:56px"><img src="${escapeHtml(`${appBase(appUrl)}/icon.svg`)}" width="42" height="42" alt="" style="display:inline-block;margin-top:7px;border:0" /></div><div style="margin-top:8px;font-size:22px;font-weight:700;color:#1c1c1e">Noise Lab</div></td></tr></table>`;
}

function button(href: string, label: string, primary: boolean): string {
  const style = primary
    ? "display:inline-block;padding:13px 22px;border-radius:999px;background:#e2483b;color:#fff;text-decoration:none;font-weight:700"
    : "display:inline-block;padding:12px 21px;border:1px solid #d7d9e2;border-radius:999px;background:#fff;color:#1c1c1e;text-decoration:none;font-weight:700";
  return `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(label)}</a>`;
}

function trackLine(track: LibraryTrack): string {
  return `${escapeHtml(displayTitle(track))} — ${escapeHtml(renderTrackFacts(track).join(" · "))}`;
}

export function renderEmailHtml(input: RenderEmailInput): string {
  const tracks = input.tracks;
  if (!tracks.length) return "";
  const batch = tracks.length > 1;
  const first = tracks[0];
  const title = displayTitle(first);
  const facts = renderTrackFacts(first);
  const fxSummary = renderFxSummary(first);
  const image = `<img src="${escapeHtml(heroUrl(input.appUrl, first.renderKey))}" width="100%" height="300" alt="${escapeHtml(`Frequency response — ${fxSummary}`)}" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:16px" />`;
  const lines = batch
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${tracks.slice(0, 3).map((track) => `<tr><td style="padding:4px 0;color:#63636b;font-size:14px;line-height:22px">${trackLine(track)}</td></tr>`).join("")}${tracks.length > 3 ? `<tr><td style="padding:4px 0;color:#63636b;font-size:14px;line-height:22px">+${tracks.length - 3} more in your Library</td></tr>` : ""}</table>`
    : "";
  const download = !batch && input.downloadUrls?.[first.renderKey]
    ? button(input.downloadUrls[first.renderKey], `Download master (${formatBytes(first.sizeBytes)})`, false)
    : "";
  const primary = button(libraryUrl(input.appUrl, batch ? undefined : first.renderKey), batch ? "Open Library" : "Open in Noise Lab", true);
  const unsubscribe = input.unsubscribeUrl
    ? `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#8e8e93;text-decoration:underline">Stop these emails</a>`
    : "";
  const date = new Date(input.finishedAt);
  const renderedDate = Number.isNaN(date.getTime()) ? input.finishedAt : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `<!doctype html><html lang="en"><body style="margin:0;padding:0;background:#eef0f6;color:#1c1c1e;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef0f6"><tr><td align="center" style="padding:40px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#fff;border-radius:24px"><tr><td style="padding:32px 24px">${headerMarkup(input.appUrl)}<h1 style="margin:28px 0 8px;text-align:center;font-size:24px;line-height:32px;color:#1c1c1e">${batch ? `${tracks.length} tracks are rendered.` : "Your track is rendered."}</h1>${batch ? `<p style="margin:0 0 18px;text-align:center;color:#63636b;font-size:16px;line-height:24px">${tracks.length} completed renders are ready in your Library.</p>` : `<p style="margin:0 0 4px;text-align:center;font-size:18px;font-weight:700;color:#1c1c1e">${escapeHtml(title)}</p><p style="margin:0 0 18px;text-align:center;color:#63636b;font-size:14px;line-height:22px">${escapeHtml(facts.join(" · "))}</p>`}<div style="margin:0 0 12px">${image}</div>${!batch ? `<p style="margin:0 0 20px;text-align:center;color:#63636b;font-size:14px;line-height:22px">${escapeHtml(fxSummary)}</p>` : lines}<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td style="padding:0 4px 0 0">${primary}</td>${download ? `<td style="padding:0 0 0 4px">${download}</td>` : ""}</tr></table><p style="margin:28px 0 0;text-align:center;color:#8e8e93;font-size:12px;line-height:18px">Rendered on ${escapeHtml(renderedDate)} · ${escapeHtml(first.variantId)}${unsubscribe ? `<br />${unsubscribe}` : ""}</p></td></tr></table></td></tr></table></body></html>`;
}

export function renderEmailText(input: RenderEmailInput): string {
  const tracks = input.tracks;
  if (!tracks.length) return "";
  const batch = tracks.length > 1;
  const first = tracks[0];
  const lines = batch
    ? tracks.slice(0, 3).map((track) => `${displayTitle(track)} — ${renderTrackFacts(track).join(" · ")}`).concat(tracks.length > 3 ? [`+${tracks.length - 3} more in your Library`] : [])
    : [`${displayTitle(first)} — ${renderTrackFacts(first).join(" · ")}`];
  const library = libraryUrl(input.appUrl, batch ? undefined : first.renderKey);
  const download = !batch && input.downloadUrls?.[first.renderKey] ? input.downloadUrls[first.renderKey] : null;
  return `${renderEmailSubject(tracks)}\n\n${lines.join("\n")}\n\n${batch ? "Open Library" : "Open in Noise Lab"}: ${library}${download ? `\nDownload master: ${download}` : ""}${input.unsubscribeUrl ? `\n\nStop these emails: ${input.unsubscribeUrl}` : ""}`;
}

export function buildRenderEmail(input: RenderEmailInput): { subject: string; html: string; text: string } {
  return { subject: renderEmailSubject(input.tracks), html: renderEmailHtml(input), text: renderEmailText(input) };
}
