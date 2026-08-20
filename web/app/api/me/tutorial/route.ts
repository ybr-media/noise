import { NextResponse } from "next/server";
import { resolveCurrentUser } from "@/lib/me";
import { markTutorialComplete, TUTORIAL_VERSION } from "@/lib/tutorial";
import { updateAuthUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const resolved = await resolveCurrentUser();
  if ("response" in resolved) return resolved.response;
  const completedAt = new Date().toISOString();
  const updated = await updateAuthUser({
    id: resolved.user.id,
    tutorialCompletedAt: completedAt,
    tutorialVersion: TUTORIAL_VERSION,
    email: resolved.user.email,
  });
  return NextResponse.json(markTutorialComplete(updated, completedAt));
}
