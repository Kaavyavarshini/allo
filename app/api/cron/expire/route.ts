import { NextResponse } from "next/server";
import { expireStale } from "@/lib/lifecycle";
import { bearerMatches } from "@/lib/auth";

export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ expired: await expireStale() });
}
