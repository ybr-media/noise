import type { Adapter } from "@auth/core/adapters";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { isAllowedEmail } from "@/lib/allowlist";

const REQUIRED_AUTH_ENV = [
  "AUTH_SECRET",
  "AUTH_RESEND_KEY",
  "AUTH_EMAIL_FROM",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "ALLOWED_EMAILS",
] as const;

export function missingAuthEnv(): string[] {
  return REQUIRED_AUTH_ENV.filter((name) => !process.env[name]?.trim());
}

export function assertAuthEnv(): void {
  const missing = missingAuthEnv();
  if (missing.length > 0) {
    throw new Error(`Auth is not configured. Missing environment variables: ${missing.join(", ")}`);
  }
}

function lazyAdapter(): Adapter {
  return new Proxy({} as Adapter, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        assertAuthEnv();
        const [{ UpstashRedisAdapter }, { Redis }] = await Promise.all([
          import("@auth/upstash-redis-adapter"),
          import("@upstash/redis"),
        ]);
        const client = new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL!,
          token: process.env.UPSTASH_REDIS_REST_TOKEN!,
        });
        const adapter = UpstashRedisAdapter(client);
        const method = Reflect.get(adapter, property);
        if (typeof method !== "function") return method;
        return method.apply(adapter, args);
      };
    },
  });
}

const emailTemplate = (url: string) => `<!doctype html>
<html lang="en"><body style="margin:0;background:#eef0f6;color:#1c1c1e;font-family:Arial,sans-serif">
<div style="max-width:520px;margin:40px auto;padding:32px 24px;background:#fff;border-radius:24px;text-align:center">
<div style="font-size:22px;font-weight:700">Noise Lab</div>
<div style="margin:24px auto;width:56px;height:56px;border-radius:50%;background:#ffdc4a;line-height:56px;font-size:28px">🔔</div>
<h1 style="font-size:24px">Sign in to Noise Lab</h1>
<p style="color:#63636b">Use this link to open your console. It expires in 15 minutes.</p>
<a href="${url}" style="display:inline-block;margin-top:12px;padding:13px 22px;border-radius:999px;background:#e2483b;color:#fff;text-decoration:none;font-weight:700">Open Noise Lab</a>
<p style="margin-top:28px;color:#8e8e93;font-size:12px">If you did not request this email, you can ignore it.</p>
</div></body></html>`;

const authConfig = {
  adapter: lazyAdapter(),
  session: { strategy: "jwt" as const, maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY ?? "",
      from: process.env.AUTH_EMAIL_FROM ?? "",
      maxAge: 15 * 60,
      async sendVerificationRequest({ identifier, url, provider }) {
        if (!isAllowedEmail(identifier)) return;
        assertAuthEnv();
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: provider.from!,
            to: identifier,
            subject: "Your Noise Lab sign-in link",
            html: emailTemplate(url),
            text: `Sign in to Noise Lab: ${url}\n\nThis link expires in 15 minutes. If you did not request it, ignore this email.`,
          }),
        });
        if (!response.ok) throw new Error(`Unable to send sign-in email: ${await response.text()}`);
      },
    }),
  ],
  callbacks: {
    async signIn({ user }: { user: { email?: string | null } }) {
      assertAuthEnv();
      return Boolean(user.email && isAllowedEmail(user.email));
    },
  },
  pages: { signIn: "/signin" },
  trustHost: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
