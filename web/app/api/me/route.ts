import { NextResponse } from "next/server";
import { auth, getAuthUserByEmail, missingAuthEnv, updateAuthUser } from "@/lib/auth";
import { markTutorialComplete, tutorialApiAccess, tutorialUserResponse, TUTORIAL_VERSION } from "@/lib/tutorial";

export const dynamic = "force-dynamic";

async function sessionEmail(): Promise<string | null> {
  if (missingAuthEnv().length > 0) return null;
  const session = await auth();
  return session?.user?.email ?? null;
}

export async function GET() {
  const authConfigured = missingAuthEnv().length === 0;
  if (tutorialApiAccess(authConfigured, null) === "open") {
    return NextResponse.json({ error: "Authentication unavailable" }, { status: 401 });
  }
  const email = await sessionEmail();
  if (!email || tutorialApiAccess(authConfigured, email) !== "authenticated") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const user = await getAuthUserByEmail(email);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json(tutorialUserResponse(user, email));
}

export async function POST() {
  const authConfigured = missingAuthEnv().length === 0;
  if (tutorialApiAccess(authConfigured, null) === "open") {
    return NextResponse.json({ error: "Authentication unavailable" }, { status: 401 });
  }
  const email = await sessionEmail();
  if (!email || tutorialApiAccess(authConfigured, email) !== "authenticated") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const user = await getAuthUserByEmail(email);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const completedAt = new Date().toISOString();
  const updated = await updateAuthUser({
    id: user.id,
    tutorialCompletedAt: completedAt,
    tutorialVersion: TUTORIAL_VERSION,
    email: user.email,
  });
  return NextResponse.json(markTutorialComplete(updated, completedAt));
}
