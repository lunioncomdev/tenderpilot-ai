import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/setup", "/api/v1/health", "/api/v1/files"];

/**
 * Contrôle léger (présence du cookie) pour rediriger vers la connexion. La
 * validation réelle de la session est faite côté serveur à chaque requête.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get("tp_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
