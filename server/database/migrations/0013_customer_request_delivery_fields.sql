-- Door delivery location captured on public estimate (optional until free-delivery threshold).
PRAGMA foreign_keys = ON;

ALTER TABLE customer_requests ADD COLUMN delivery_address TEXT;
ALTER TABLE customer_requests ADD COLUMN delivery_landmark TEXT;
ALTER TABLE customer_requests ADD COLUMN delivery_maps_url TEXT;
