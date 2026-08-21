import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return process.env.NOISE_DOWNLOAD_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "";
}

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function signPayload(payload: { f: string; e?: number }): string {
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${signature(encoded)}`;
}

function verifyPayload(token: string): { f: string; e?: number } | null {
  if (!secret()) return null;
  const [payload, encodedSignature] = token.split(".");
  if (!payload || !encodedSignature) return null;
  const expected = signature(payload);
  const actual = Buffer.from(encodedSignature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  const decoded = decode(payload);
  if (!decoded) return null;
  try {
    const value = JSON.parse(decoded) as { f?: unknown; e?: unknown };
    if (typeof value.f !== "string") return null;
    if (value.e !== undefined && (typeof value.e !== "number" || Date.now() >= value.e)) return null;
    return { f: value.f, ...(typeof value.e === "number" ? { e: value.e } : {}) };
  } catch {
    return null;
  }
}

export function signDownloadToken(filename: string, expiresAt: number): string {
  return signPayload({ f: filename, e: expiresAt });
}

export function verifyDownloadToken(token: string): { filename: string } | null {
  const payload = verifyPayload(token);
  return payload ? { filename: payload.f } : null;
}

export function signUnsubscribeToken(email: string): string {
  return signPayload({ f: email });
}

export function verifyUnsubscribeToken(token: string): string | null {
  return verifyPayload(token)?.f ?? null;
}
