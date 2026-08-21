import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";
import { auth, missingAuthEnv } from "@/lib/auth";
import { accessForRequest, isAuthOpenMode } from "@/lib/middleware-access";

let openModeWarningLogged = false;
const guardedMiddleware = auth((request) => {
  const access = accessForRequest(request.nextUrl.pathname, Boolean(request.auth));
  if (access === "next") return NextResponse.next();
  if (access === "unauthorized") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const signInUrl = new URL("/signin", request.url);
  signInUrl.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(signInUrl);
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (isAuthOpenMode(missingAuthEnv())) {
    if (!openModeWarningLogged) {
      console.warn("[auth] Authentication env is not configured; middleware is running in open mode.");
      openModeWarningLogged = true;
    }
    return NextResponse.next();
  }
  return guardedMiddleware(request, event as unknown as Parameters<typeof guardedMiddleware>[1]);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|signin(?:/.*)?|api/auth(?:/.*)?|api/audio(?:/.*)?|api/og(?:/.*)?|api/download(?:/.*)?|api/renders/notify|api/notifications/unsubscribe|(?!(?:api/)).*\\.[^/]+$).*)"],
};
