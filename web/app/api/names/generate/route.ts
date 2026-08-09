import { NextRequest, NextResponse } from "next/server";
import { findVariant } from "@/lib/config";
import { localStubProvider } from "@/lib/naming";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { variantId?: unknown; candidate?: unknown; siblingTitles?: unknown };
  const variant = typeof body.variantId === "string" ? findVariant(body.variantId) : undefined;
  if (!variant) return NextResponse.json({ error: "Unknown variant" }, { status: 404 });
  const siblingTitles = Array.isArray(body.siblingTitles)
    ? body.siblingTitles.filter((title): title is string => typeof title === "string")
    : [];
  return NextResponse.json({
    suggestion: localStubProvider.generate(variant, typeof body.candidate === "number" ? body.candidate : 0, siblingTitles),
  });
}
