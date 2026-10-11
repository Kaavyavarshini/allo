/** Pure types + errors for the inventory service layer (no DB import, so it is easy to fake in tests). */

export type StockRow = {
  warehouse: string; // warehouse code, e.g. "CHN"
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  available: number;
};

export type ReservationView = {
  id: string;
  status: "PENDING" | "CONFIRMED" | "RELEASED" | "EXPIRED";
  expiresAt: string; // ISO
  items: { sku: string; warehouse: string; quantity: number }[];
};

export type ReserveInput = {
  sku: string;
  warehouseCode: string;
  quantity: number;
  idempotencyKey: string;
  ttlMinutes?: number;
};

export type ErrorCode = "UNKNOWN_SKU" | "UNKNOWN_WAREHOUSE" | "INSUFFICIENT_STOCK" | "NOT_FOUND";

/** Errors whose message is safe and useful to show to an LLM / end user. */
export class InventoryError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

export interface Inventory {
  getStock(filter: { sku?: string; warehouseCode?: string }): Promise<StockRow[]>;
  /** Warehouses that can fulfil `quantity` of `sku` right now, most available first. */
  findAvailability(sku: string, quantity: number): Promise<StockRow[]>;
  lowStock(threshold: number): Promise<StockRow[]>;
  getReservation(id: string): Promise<ReservationView | null>;
  reserve(input: ReserveInput): Promise<ReservationView>;
  confirm(id: string): Promise<boolean>;
  release(id: string): Promise<boolean>;
}
