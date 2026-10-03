-- Supplemental reference metadata; existing provider profiles remain untouched.
CREATE TABLE IF NOT EXISTS asset_reference_classifications (
  symbol VARCHAR(30) PRIMARY KEY,
  sector_name TEXT,
  sector_code VARCHAR(2) CHECK (sector_code IS NULL OR sector_code ~ '^[0-9]{2}$'),
  industry_group_name TEXT,
  industry_group_code VARCHAR(4) CHECK (industry_group_code IS NULL OR industry_group_code ~ '^[0-9]{4}$'),
  industry_name TEXT,
  industry_code VARCHAR(6) CHECK (industry_code IS NULL OR industry_code ~ '^[0-9]{6}$'),
  source TEXT NOT NULL DEFAULT 'FinanceDatabase',
  source_url TEXT,
  taxonomy_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('matched','unmapped','not_found','conflict')),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
