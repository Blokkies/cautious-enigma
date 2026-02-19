import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";

const PUBLIC_PATHS = ["/", "/api/auth/login", "/api/auth/admin-login", "/api/auth/logout", "/api/auth/list", "/api/auth/me"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/manifest") ||
    pathname.startsWith("/icon-") ||
    pathname.startsWith("/sw.js")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("stocktake-token")?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  const payload = await verifyToken(token);
  if (!payload) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Role-based access control
  if (pathname.startsWith("/team") && payload.type !== "team") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname.startsWith("/supervisor")) {
    // Allow admin to access supervisor export page
    const adminAllowedSupervisorPaths = ["/supervisor/export"];
    const isAdminAllowed =
      payload.type === "admin" &&
      adminAllowedSupervisorPaths.some((p) => pathname.startsWith(p));
    if (payload.type !== "supervisor" && payload.type !== "auditor" && !isAdminAllowed) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }
  const supervisorAllowedAdminApis = ["/api/admin/teams", "/api/admin/assign"];
  // Protect /admin page routes
  if (pathname.startsWith("/admin") && payload.type !== "admin") {
    if (!((payload.type === "supervisor" || payload.type === "auditor") && supervisorAllowedAdminApis.some(p => pathname.startsWith(p)))) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }
  // Protect /api/admin/* API routes (defense in depth alongside handler-level checks)
  if (pathname.startsWith("/api/admin/") && payload.type !== "admin") {
    const isSupervisorAllowed = (payload.type === "supervisor" || payload.type === "auditor") &&
      supervisorAllowedAdminApis.some(p => pathname.startsWith(p));
    if (!isSupervisorAllowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  // /completed is accessible to supervisors and admins
  if (
    pathname.startsWith("/completed") &&
    payload.type !== "supervisor" &&
    payload.type !== "admin" &&
    payload.type !== "auditor"
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Pass user info in headers for API routes
  const response = NextResponse.next();
  response.headers.set("x-user-id", String(payload.id));
  response.headers.set("x-user-type", payload.type);
  response.headers.set("x-user-name", payload.name);
  response.headers.set("x-event-id", String(payload.eventId));

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
