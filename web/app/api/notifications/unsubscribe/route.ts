import { NextRequest } from "next/server";
import { getAuthUserByEmail, updateAuthUser } from "@/lib/auth";
import { verifyUnsubscribeToken } from "@/lib/download-token";

function page(message: string): Response {
  const base = process.env.NOISE_APP_URL?.trim() || process.env.AUTH_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return new Response(`<!doctype html><html><body style="margin:0;background:#eef0f6;color:#1c1c1e;font-family:Arial,sans-serif"><main style="max-width:520px;margin:48px auto;padding:32px 24px;background:#fff;border-radius:24px;text-align:center"><h1>Noise Lab</h1><p>${message}</p><a href="${base}/" style="color:#e2483b">Open Noise Lab</a></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function unsubscribe(request: NextRequest): Promise<Response> {
  let token = request.nextUrl.searchParams.get("token");
  if (!token && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    token = form?.get("token")?.toString() ?? null;
  }
  const email = token ? verifyUnsubscribeToken(token) : null;
  if (!email) return page("This unsubscribe link is invalid or expired.");
  try {
    const user = await getAuthUserByEmail(email);
    if (user) await updateAuthUser({ id: user.id, renderEmails: false });
    return page("You will no longer receive render-complete emails.");
  } catch {
    return page("We could not update your preferences right now.");
  }
}

export async function GET(request: NextRequest) { return unsubscribe(request); }
export async function POST(request: NextRequest) { return unsubscribe(request); }
