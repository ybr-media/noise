import { NextResponse } from "next/server";
import type { AdapterUser } from "@auth/core/adapters";
import { auth, getAuthUserByEmail, missingAuthEnv } from "@/lib/auth";

export type CurrentUser = {
  email: string;
  user: AdapterUser;
};

export type CurrentUserResolution = CurrentUser | { response: NextResponse };

export async function resolveCurrentUser(): Promise<CurrentUserResolution> {
  if (missingAuthEnv().length > 0) {
    return { response: NextResponse.json({ error: "Authentication unavailable" }, { status: 401 }) };
  }
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }
  const user = await getAuthUserByEmail(email);
  if (!user) {
    return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }
  return { email, user };
}
