import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time bearer-token check. Fails CLOSED: if the expected secret is
 * missing or empty, nothing is authorised (the old cron check accepted the
 * literal header "Bearer undefined" when CRON_SECRET was unset).
 */
export function bearerMatches(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function apiKeyOk(req: Request): boolean {
  return bearerMatches(req.headers.get("authorization"), process.env.ALLO_API_KEY);
}
