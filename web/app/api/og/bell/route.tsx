import { ImageResponse } from "next/og";
import { BELL_MARK_BODY } from "@/lib/bell-mark";

export const runtime = "nodejs";

export async function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="-1 0 102 100">${BELL_MARK_BODY}</svg>`;
  const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: 128,
        height: 128,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 64,
        background: "#ffdc4a",
      }}
    >
      <img src={image} width={100} height={100} alt="Noise Lab bell" />
    </div>,
    {
      width: 128,
      height: 128,
      headers: { "Cache-Control": "public, max-age=86400, immutable" },
    },
  );
}
