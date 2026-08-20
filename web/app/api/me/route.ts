import { NextResponse } from "next/server";
import { resolveCurrentUser } from "@/lib/me";
import { tutorialUserResponse } from "@/lib/tutorial";

export const dynamic = "force-dynamic";

export async function GET() {
  const resolved = await resolveCurrentUser();
  if ("response" in resolved) return resolved.response;
  return NextResponse.json(tutorialUserResponse(resolved.user, resolved.email));
}
