import { ImageResponse } from "next/og";
import { libraryTracks } from "@/lib/library";
import { eqCardPath, eqCardPoints } from "@/lib/eq-card";
import { EQ_PRESET_LABELS, type EqPreset } from "@/lib/fx";
import { renderFxSummary } from "@/lib/render-email";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ renderKey: string }> }) {
  const { renderKey } = await context.params;
  const track = (await libraryTracks()).find((candidate) => candidate.renderKey === renderKey && candidate.exists);
  if (!track) return new Response("Track not found", { status: 404 });
  const width = 920;
  const height = 360;
  const points = eqCardPoints(track.recipe.eq?.gains_db ?? [], width, height);
  const path = eqCardPath(points);
  const grid = [0, 1, 2, 3, 4].map((line) => `<rect x="0" y="${40 + line * 70}" width="${width}" height="1" fill="#e6e9f1"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="${path} L${width},${height} L0,${height} Z" fill="#007aff" fill-opacity=".08"/>${grid}<path d="${path}" fill="none" stroke="#007aff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/></svg>`;
  const curve = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const fx = renderFxSummary(track);
  const response = new ImageResponse(
    <div style={{ width: 1040, height: 600, display: "flex", padding: 40, background: "#eef0f6", fontFamily: "Arial", color: "#1c1c1e" }}>
      <div style={{ width: 960, height: 520, display: "flex", flexDirection: "column", padding: 28, borderRadius: 24, background: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 22, fontWeight: 700 }}>
          <span>Frequency response</span>
          <span style={{ padding: "8px 14px", borderRadius: 999, background: "#e8f1ff", color: "#007aff", fontSize: 18 }}>{fx}</span>
        </div>
        <div style={{ position: "relative", display: "flex", width: 920, height: 360, marginTop: 16, borderRadius: 16, background: "#fafbfe", overflow: "hidden" }}>
          {[0, 1, 2, 3, 4, 5].map((line) => <div key={`v-${line}`} style={{ position: "absolute", top: 0, bottom: 0, left: line * 184, width: 1, background: "#e6e9f1" }} />)}
          <img src={curve} width={920} height={360} alt="EQ response curve" style={{ position: "absolute", left: 0, top: 0 }} />
          <span style={{ position: "absolute", left: 10, bottom: 10, fontSize: 16, color: "#63636b" }}>30 Hz</span>
          <span style={{ position: "absolute", left: 226, bottom: 10, fontSize: 16, color: "#63636b" }}>100 Hz</span>
          <span style={{ position: "absolute", left: 430, bottom: 10, fontSize: 16, color: "#63636b" }}>1 kHz</span>
          <span style={{ position: "absolute", left: 650, bottom: 10, fontSize: 16, color: "#63636b" }}>10 kHz</span>
          <span style={{ position: "absolute", right: 10, bottom: 10, fontSize: 16, color: "#63636b" }}>16 kHz</span>
        </div>
        <div style={{ display: "flex", marginTop: 14, fontSize: 18, color: "#63636b" }}>{track.recipe.eq ? `EQ: ${EQ_PRESET_LABELS[track.recipe.eq.preset as EqPreset] ?? "Custom"}` : "EQ: Flat"}</div>
      </div>
    </div>,
    { width: 1040, height: 600, headers: { "Cache-Control": "public, max-age=86400, immutable" } },
  );
  return response;
}
