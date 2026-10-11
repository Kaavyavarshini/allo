import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: protect the JSON API with a bearer key.
 * /api/cron/* has its own secret check; the UI page reads the DB server-side.
 * Edge runtime has no node:crypto, so this is a plain equality check on a
 * high-entropy key; routes that need constant-time compare use lib/auth.ts.
 */
export const config = { matcher: ["/api/stock/:path*", "/api/reservations/:path*", "/api/mcp/:path*", "/api/tool-calls/:path*"] };

export function middleware(req: NextRequest) {
  const key = process.env.ALLO_API_KEY;
  const auth = req.headers.get("authorization");
  if (!key || auth !== `Bearer ${key}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}
