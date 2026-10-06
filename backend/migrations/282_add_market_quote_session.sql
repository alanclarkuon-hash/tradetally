ALTER TABLE price_monitoring ADD COLUMN IF NOT EXISTS quote_session TEXT;
-- NULL means the source did not identify the session; existing prices stay unknown.
