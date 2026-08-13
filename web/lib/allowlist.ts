export function isAllowedEmail(email: string, allowlist = process.env.ALLOWED_EMAILS ?? ""): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return false;
  return allowlist.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean).some((entry) => {
    if (entry.startsWith("@")) return normalized.endsWith(entry) && normalized.length > entry.length;
    return normalized === entry;
  });
}
