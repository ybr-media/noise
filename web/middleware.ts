import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { accessForRequest } from "@/lib/middleware-access";

export default auth((request) => {
  const access = accessForRequest(request.nextUrl.pathname, Boolean(request.auth));
  if (access === "next") return NextResponse.next();
  if (access === "unauthorized") {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const signInUrl = new URL("/signin", request.url);
  signInUrl.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|signin(?:/.*)?|api/auth(?:/.*)?|api/audio(?:/.*)?).*)"],
};
