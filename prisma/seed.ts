import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const warehouses = [
    { code: "CHN", name: "Chennai Hub", city: "Chennai" },
    { code: "BLR", name: "Bengaluru Hub", city: "Bengaluru" },
    { code: "HYD", name: "Hyderabad Hub", city: "Hyderabad" },
  ];
  const products = [
    { sku: "SKU-1001", name: "Wireless Mouse" },
    { sku: "SKU-1002", name: "Mechanical Keyboard" },
    { sku: "SKU-1003", name: "USB-C Hub" },
    { sku: "SKU-1004", name: "Laptop Stand" },
    { sku: "SKU-1005", name: "Webcam" },
  ];
  const ws = await Promise.all(
    warehouses.map((w) => prisma.warehouse.upsert({ where: { code: w.code }, update: {}, create: w }))
  );
  const ps = await Promise.all(
    products.map((p) => prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: p }))
  );
  for (const w of ws) {
    for (const p of ps) {
      await prisma.stock.upsert({
        where: { warehouseId_productId: { warehouseId: w.id, productId: p.id } },
        update: {},
        create: { warehouseId: w.id, productId: p.id, onHand: 20 + Math.floor(Math.random() * 80) },
      });
    }
  }
  console.log(`Seeded ${ws.length} warehouses, ${ps.length} products`);
}

main().finally(() => prisma.$disconnect());
