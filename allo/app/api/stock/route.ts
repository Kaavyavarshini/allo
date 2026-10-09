import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.stock.findMany({
    include: { warehouse: true, product: true },
    orderBy: [{ warehouseId: "asc" }, { productId: "asc" }],
  });
  return NextResponse.json(
    rows.map((s) => ({
      warehouseId: s.warehouseId,
      warehouse: s.warehouse.code,
      productId: s.productId,
      sku: s.product.sku,
      onHand: s.onHand,
      reserved: s.reserved,
      available: s.onHand - s.reserved,
    }))
  );
}
