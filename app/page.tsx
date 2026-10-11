import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const rows = await prisma.stock.findMany({
    include: { warehouse: true, product: true },
    orderBy: [{ warehouse: { code: "asc" } }, { product: { sku: "asc" } }],
  });
  return (
    <main>
      <h1>Allo: live stock</h1>
      <table cellPadding={8} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Warehouse</th><th>SKU</th><th>On hand</th><th>Reserved</th><th>Available</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.warehouseId + s.productId} style={{ borderBottom: "1px solid #eee" }}>
              <td>{s.warehouse.code}</td>
              <td>{s.product.sku}</td>
              <td>{s.onHand}</td>
              <td>{s.reserved}</td>
              <td>{s.onHand - s.reserved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
