-- Observed total account values; distinct from holdings-only legacy snapshots.
CREATE TABLE IF NOT EXISTS portfolio_value_history (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_identifier TEXT NOT NULL,
  value_date DATE NOT NULL,
  holdings_usd NUMERIC(20,6) NOT NULL,
  cash_usd NUMERIC(20,6) NOT NULL,
  stablecoins_usd NUMERIC(20,6) NOT NULL,
  gbp_per_usd NUMERIC(20,10),
  stale_prices INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, account_identifier, value_date)
);
