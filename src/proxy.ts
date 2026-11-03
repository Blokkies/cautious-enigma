import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { legacyAdminRedirect } from "@/lib/admin-routes";

const PUBLIC_PATHS = ["/", "/api/auth/login", "/api/auth/admin-login", "/api/auth/executive-login", "/api/auth/logout", "/api/auth/list", "/api/auth/me", "/api/health"];

export async function proxy(request: NextRequest) {
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

  // Old admin URLs (bookmarks, links) move to the redesigned admin area. The target is
  // itself an /admin route, so the role checks below still apply on the next request.
  const legacyTarget = legacyAdminRedirect(pathname, request.nextUrl.searchParams);
  if (legacyTarget) {
    return NextResponse.redirect(new URL(legacyTarget, request.url));
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

  // Role-based access control for pages and API routes
  if (pathname.startsWith("/api/team/") && payload.type !== "team") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (pathname.startsWith("/team") && payload.type !== "team") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname.startsWith("/api/supervisor/")) {
    // Allow admin to access supervisor export API
    const adminAllowedSupervisorApis = ["/api/supervisor/export", "/api/supervisor/dashboard"];
    const isAdminAllowed = payload.type === "admin" &&
      adminAllowedSupervisorApis.some((p) => pathname.startsWith(p));
    // Executives get read-only access to supervisor routes (like auditors)
    if (payload.type !== "supervisor" && payload.type !== "auditor" && payload.type !== "executive" && !isAdminAllowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (pathname.startsWith("/supervisor")) {
    // Allow admin to access supervisor export page
    const adminAllowedSupervisorPaths = ["/supervisor/export"];
    const isAdminAllowed =
      payload.type === "admin" &&
      adminAllowedSupervisorPaths.some((p) => pathname.startsWith(p));
    // Executives get read-only access to supervisor pages (like auditors)
    if (payload.type !== "supervisor" && payload.type !== "auditor" && payload.type !== "executive" && !isAdminAllowed) {
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
  // Protect /executive page routes (executive + admin)
  if (pathname.startsWith("/executive") && payload.type !== "executive" && payload.type !== "admin") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  // Protect /api/executive/* API routes (executive + admin)
  if (pathname.startsWith("/api/executive/") && payload.type !== "executive" && payload.type !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  // Pass user info to route handlers as REQUEST headers (never response headers).
  // Strip any client-supplied copies first so they can't be spoofed.
  const requestHeaders = new Headers(request.headers);
  for (const h of ["x-user-id", "x-user-type", "x-user-name", "x-event-id", "x-event-status"]) {
    requestHeaders.delete(h);
  }
  requestHeaders.set("x-user-id", String(payload.id));
  requestHeaders.set("x-user-type", payload.type);
  // Header values must be Latin-1; encode so names with any Unicode character work.
  requestHeaders.set("x-user-name", encodeURIComponent(payload.name));
  requestHeaders.set("x-event-id", String(payload.eventId));
  // No x-event-status: the token's status is a login-time snapshot and goes
  // stale. Handlers that care read the live status (checkEventActive).

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
