import type { Adapter, AdapterUser } from "@auth/core/adapters";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { isAllowedEmail } from "@/lib/allowlist";
import { TUTORIAL_VERSION } from "@/lib/tutorial";
import { TOKENS } from "@/app/ui/tokens";
import { sendEmail } from "@/lib/email";

const REQUIRED_AUTH_ENV = [
  "AUTH_SECRET",
  "AUTH_RESEND_KEY",
  "AUTH_EMAIL_FROM",
  "ALLOWED_EMAILS",
] as const;

const AUTH_REDIS_ENV = {
  url: ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"],
  token: ["UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"],
} as const;

type AuthRedisEnv = {
  url: string | undefined;
  token: string | undefined;
};

const ADAPTER_METHOD_NAMES = [
  "createUser",
  "getUser",
  "getUserByEmail",
  "getUserByAccount",
  "updateUser",
  "linkAccount",
  "createSession",
  "getSessionAndUser",
  "updateSession",
  "deleteSession",
  "createVerificationToken",
  "useVerificationToken",
  "unlinkAccount",
  "deleteUser",
] as const;

const adapterMethodNames = new Set<string>(ADAPTER_METHOD_NAMES);

function firstConfiguredEnv(names: readonly string[]): string | undefined {
  return names.map((name) => process.env[name]?.trim()).find(Boolean);
}

export function resolveAuthRedisEnv(): AuthRedisEnv {
  return {
    url: firstConfiguredEnv(AUTH_REDIS_ENV.url),
    token: firstConfiguredEnv(AUTH_REDIS_ENV.token),
  };
}

export function missingAuthEnv(): string[] {
  const missing: string[] = REQUIRED_AUTH_ENV.filter((name) => !process.env[name]?.trim());
  const redis = resolveAuthRedisEnv();
  if (!redis.url) missing.push("UPSTASH_REDIS_REST_URL or KV_REST_API_URL");
  if (!redis.token) missing.push("UPSTASH_REDIS_REST_TOKEN or KV_REST_API_TOKEN");
  return missing;
}

export function assertAuthEnv(): void {
  const missing = missingAuthEnv();
  if (missing.length > 0) {
    throw new Error(`Auth is not configured. Missing environment variables: ${missing.join(", ")}`);
  }
}

export function lazyAdapter(): Adapter {
  const target = Object.assign(
    Object.create(null),
    Object.fromEntries(ADAPTER_METHOD_NAMES.map((name) => [name, () => undefined])),
  ) as Adapter;
  return new Proxy(target, {
    get(target, property, receiver) {
      if (typeof property !== "string" || !adapterMethodNames.has(property)) {
        return Reflect.get(target, property, receiver);
      }
      return async (...args: unknown[]) => {
        assertAuthEnv();
        const [{ UpstashRedisAdapter }, { Redis }] = await Promise.all([
          import("@auth/upstash-redis-adapter"),
          import("@upstash/redis"),
        ]);
        const redisEnv = resolveAuthRedisEnv();
        const client = new Redis({
          url: redisEnv.url!,
          token: redisEnv.token!,
        });
        const adapter = UpstashRedisAdapter(client);
        const method = Reflect.get(adapter, property);
        if (typeof method !== "function") return method;
        if (property === "createUser" && args[0] && typeof args[0] === "object") {
          args[0] = {
            ...(args[0] as Record<string, unknown>),
            tutorialCompletedAt: null,
            tutorialVersion: TUTORIAL_VERSION,
            renderEmails: true,
          };
        }
        return method.apply(adapter, args);
      };
    },
    has(target, property) {
      return Reflect.has(target, property);
    },
  });
}

const authAdapter = lazyAdapter();

const emailTemplate = (url: string) => `<!doctype html>
<html lang="en"><body style="margin:0;background:#eef0f6;color:#1c1c1e;font-family:Arial,sans-serif">
<div style="max-width:520px;margin:40px auto;padding:32px 24px;background:#fff;border-radius:24px;text-align:center">
<div style="font-size:22px;font-weight:700">Noise Lab</div>
<div style="margin:24px auto;width:56px;height:56px;border-radius:50%;background:#ffdc4a;line-height:56px">
<svg width="30" height="30" viewBox="-1 0 102 100" aria-hidden="true" style="margin-top:13px"><path fill="#ffdc4a" d="M 70.7 97.2 C 51.0 96.6 27.2 91.1 13.5 83.9 C 6.3 80.2 2.4 76.3 2.9 73.4 C 3.4 71.0 4.5 69.7 7.2 68.7 C 7.8 68.4 8.1 68.3 8.5 68.0 C 13.2 65.1 17.7 55.0 22.8 36.3 C 25.7 25.5 32.4 18.3 42.6 15.0 C 56.8 10.4 75.6 14.6 85.5 24.6 C 90.6 29.8 93.2 35.9 93.5 43.2 L 93.5 44.2 L 93.5 45.2 C 93.4 46.9 93.4 47.5 93.0 49.9 C 90.5 68.4 90.7 79.1 93.7 83.6 C 94.0 84.0 94.3 84.4 94.9 85.0 C 96.3 86.4 97.0 87.4 97.1 88.8 L 97.1 89.2 L 97.1 89.6 C 96.9 91.6 96.2 92.6 94.3 93.8 C 90.1 96.3 81.3 97.6 70.7 97.2 ZM 62.8 93.0 C 65.9 92.8 68.8 91.2 70.5 88.8 L 70.7 88.5 L 70.9 88.5 C 75.9 88.9 80.8 89.1 83.3 88.9 C 86.0 88.7 87.5 88.4 88.2 87.8 L 88.3 87.6 L 88.5 87.7 C 88.6 87.7 88.9 87.9 89.2 88.1 C 89.7 88.4 89.8 88.4 90.1 88.4 C 90.7 88.5 91.3 88.2 91.6 87.7 L 91.7 87.4 L 91.7 87.2 L 91.7 86.9 L 91.6 86.7 C 91.5 86.2 91.2 85.9 89.7 85.1 C 77.3 78.7 43.4 71.5 20.9 70.5 C 19.7 70.5 15.4 70.5 14.4 70.5 C 12.5 70.7 10.8 70.8 9.8 71.1 C 9.2 71.2 8.8 71.6 8.7 72.2 L 8.6 72.4 L 8.7 72.6 C 8.8 73.2 9.2 73.7 9.9 73.8 L 10.1 73.8 L 10.3 73.8 C 10.4 73.7 10.8 73.7 11.1 73.6 C 11.5 73.6 11.8 73.5 11.8 73.5 L 12.0 73.5 L 11.9 73.6 C 10.9 74.7 13.4 76.4 18.9 78.3 C 19.6 78.6 21.5 79.2 22.0 79.4 C 22.1 79.4 22.6 79.6 23.0 79.7 C 30.1 81.8 40.6 84.2 50.6 85.9 C 51.4 86.0 52.1 86.1 52.2 86.1 C 52.2 86.1 52.3 86.3 52.3 86.5 C 53.8 90.7 58.2 93.4 62.8 93.0 ZM 61.3 90.3 C 60.5 90.2 59.6 90.0 58.8 89.6 C 54.3 87.5 53.2 81.9 56.8 78.4 L 57.0 78.2 L 57.2 78.2 C 60.1 78.8 62.1 79.3 64.4 79.8 C 66.7 80.4 68.8 80.9 68.9 81.0 C 69.1 81.1 69.3 82.5 69.3 83.3 C 69.3 87.4 65.6 90.7 61.3 90.3 ZM 51.4 64.5 C 62.3 63.7 70.6 55.1 70.4 44.6 C 70.1 32.3 58.1 23.4 45.5 26.0 C 34.7 28.3 27.7 38.5 29.9 48.9 C 31.9 58.5 41.2 65.2 51.4 64.5 ZM 87.8 45.8 C 88.6 45.5 88.8 45.0 88.6 43.7 C 87.0 33.9 81.3 25.8 73.2 22.0 C 72.4 21.7 72.3 21.6 71.9 21.6 C 71.2 21.7 70.7 22.1 70.5 22.8 L 70.5 23.0 L 70.5 23.2 C 70.6 23.5 70.7 23.8 70.9 24.0 L 71.1 24.1 L 71.6 24.4 C 79.1 27.8 84.4 35.2 85.8 44.3 L 85.9 45.0 L 86.0 45.2 C 86.3 45.8 87.1 46.1 87.8 45.8 ZM 72.1 13.3 C 68.2 11.9 63.3 10.8 58.9 10.5 C 58.4 10.5 57.9 10.4 57.8 10.4 L 57.6 10.4 L 57.7 10.0 C 57.9 6.3 60.6 3.4 64.5 2.8 L 64.8 2.8 L 65.6 2.8 L 66.3 2.8 L 66.7 2.8 C 71.8 3.6 74.8 8.5 72.9 13.1 C 72.8 13.3 72.7 13.5 72.7 13.5 C 72.7 13.5 72.4 13.4 72.1 13.3 Z" /></svg>
</div>
<h1 style="font-size:24px">Sign in to Noise Lab</h1>
<p style="color:#63636b">Use this link to open your console. It expires in 15 minutes.</p>
<a href="${url}" style="display:inline-block;margin-top:12px;padding:13px 22px;border-radius:999px;background:${TOKENS.brand};color:#fff;text-decoration:none;font-weight:700">Open Noise Lab</a>
<p style="margin-top:28px;color:#8e8e93;font-size:12px">If you did not request this email, you can ignore it.</p>
</div></body></html>`;

const authConfig = {
  adapter: authAdapter,
  session: { strategy: "jwt" as const, maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY ?? "",
      from: process.env.AUTH_EMAIL_FROM ?? "",
      maxAge: 15 * 60,
      async sendVerificationRequest({ identifier, url }) {
        if (!isAllowedEmail(identifier)) return;
        assertAuthEnv();
        await sendEmail({
          to: identifier,
          subject: "Your Noise Lab sign-in link",
          html: emailTemplate(url),
          text: `Sign in to Noise Lab: ${url}\n\nThis link expires in 15 minutes. If you did not request it, ignore this email.`,
        });
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

export async function getAuthUserByEmail(email: string): Promise<AdapterUser | null> {
  assertAuthEnv();
  return (await authAdapter.getUserByEmail?.(email)) ?? null;
}

export async function updateAuthUser(user: Partial<AdapterUser> & Pick<AdapterUser, "id"> & Record<string, unknown>): Promise<AdapterUser> {
  assertAuthEnv();
  if (!authAdapter.updateUser) throw new Error("Auth adapter does not support user updates.");
  return authAdapter.updateUser(user as Partial<AdapterUser> & Pick<AdapterUser, "id">);
}
