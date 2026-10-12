-- Public provider metadata only; no account or holdings data.
CREATE TABLE IF NOT EXISTS portfolio_display_metadata (
 symbol VARCHAR(64) PRIMARY KEY,
 profile JSONB,
 fund_categories JSONB,
 fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
