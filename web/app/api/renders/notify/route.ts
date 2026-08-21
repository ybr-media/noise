import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { notifyRenderComplete, type RenderNotification } from "@/lib/render-notifications";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > 64 * 1024) return new NextResponse("Payload too large", { status: 413 });
  const secret = process.env.NOISE_NOTIFY_SECRET?.trim();
  const provided = request.headers.get("x-noise-signature") ?? "";
  if (!secret || !provided.startsWith("sha256=")) return new NextResponse("Unauthorized", { status: 401 });
  const actual = Buffer.from(provided.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new NextResponse("Unauthorized", { status: 401 });
  let notification: RenderNotification;
  try {
    const parsed = JSON.parse(body.toString("utf8")) as Partial<RenderNotification>;
    if (parsed.kind !== "render-complete" || typeof parsed.requestedBy !== "string" || !Array.isArray(parsed.renderKeys) || typeof parsed.finishedAt !== "string") {
      return new NextResponse("Invalid notification", { status: 400 });
    }
    notification = {
      kind: "render-complete",
      requestedBy: parsed.requestedBy,
      renderKeys: parsed.renderKeys.filter((key): key is string => typeof key === "string"),
      runId: typeof parsed.runId === "string" ? parsed.runId : undefined,
      finishedAt: parsed.finishedAt,
    };
  } catch {
    return new NextResponse("Invalid notification", { status: 400 });
  }
  return NextResponse.json({ status: await notifyRenderComplete(notification) });
}
