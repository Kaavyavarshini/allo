import { NextResponse } from "next/server";
import { expireStale } from "@/lib/lifecycle";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ expired: await expireStale() });
}
