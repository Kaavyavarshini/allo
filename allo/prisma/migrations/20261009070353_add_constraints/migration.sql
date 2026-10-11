ALTER TABLE "Stock"
  ADD CONSTRAINT stock_non_negative CHECK ("onHand" >= 0 AND "reserved" >= 0),
  ADD CONSTRAINT stock_reserved_le_onhand CHECK ("reserved" <= "onHand");

ALTER TABLE "ReservationItem"
  ADD CONSTRAINT qty_positive CHECK ("quantity" > 0);
