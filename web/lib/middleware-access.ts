export function shouldBypassAuth(pathname: string): boolean {
  return pathname === "/signin"
    || pathname.startsWith("/_next/static/")
    || pathname.startsWith("/_next/image")
    || pathname === "/favicon.ico"
    || pathname.startsWith("/api/auth/")
    || pathname.startsWith("/api/audio/");
}

export function accessForRequest(pathname: string, authenticated: boolean): "next" | "redirect" | "unauthorized" {
  if (shouldBypassAuth(pathname) || authenticated) return "next";
  return pathname.startsWith("/api/") ? "unauthorized" : "redirect";
}
