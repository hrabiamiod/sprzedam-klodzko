ALTER TABLE listings ADD COLUMN featured_at TEXT;
ALTER TABLE listings ADD COLUMN featured_until TEXT;
ALTER TABLE listings ADD COLUMN featured_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_listings_featured_until ON listings(featured_until DESC);
