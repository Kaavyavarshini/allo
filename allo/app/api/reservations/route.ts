import { NextResponse } from "next/server";
import { z } from "zod";
import { reserve } from "@/lib/reserve";

const Body = z.object({
  idempotencyKey: z.string().min(8).max(100),
  ttlMinutes: z.number().int().min(1).max(120).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        warehouseId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { idempotencyKey, items, ttlMinutes } = parsed.data;
  try {
    const reservation = await reserve(idempotencyKey, items, ttlMinutes);
    return NextResponse.json(reservation, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg.startsWith("INSUFFICIENT_STOCK")) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
