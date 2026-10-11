import { NextResponse } from "next/server";
import { confirm } from "@/lib/lifecycle";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await confirm(id);
  return ok
    ? NextResponse.json({ id, status: "CONFIRMED" })
    : NextResponse.json({ error: "not pending, expired, or not found" }, { status: 409 });
}
