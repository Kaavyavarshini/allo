import { NextResponse } from "next/server";
import { release } from "@/lib/lifecycle";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await release(id);
  return ok
    ? NextResponse.json({ id, status: "RELEASED" })
    : NextResponse.json({ error: "not pending or not found" }, { status: 409 });
}
