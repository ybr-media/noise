import { NextRequest, NextResponse } from "next/server";
import { findVariant } from "@/lib/config";
import { localStubProvider } from "@/lib/naming";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { variantId?: unknown; candidate?: unknown };
  const variant = typeof body.variantId === "string" ? findVariant(body.variantId) : undefined;
  if (!variant) return NextResponse.json({ error: "Unknown variant" }, { status: 404 });
  return NextResponse.json({ suggestion: localStubProvider.generate(variant, typeof body.candidate === "number" ? body.candidate : 0) });
}
