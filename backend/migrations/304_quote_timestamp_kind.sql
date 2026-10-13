ALTER TABLE price_monitoring ADD COLUMN IF NOT EXISTS timestamp_kind TEXT NOT NULL DEFAULT 'observed';
ALTER TABLE price_monitoring ADD CONSTRAINT price_monitoring_timestamp_kind_check CHECK(timestamp_kind IN ('trade','observed'));
