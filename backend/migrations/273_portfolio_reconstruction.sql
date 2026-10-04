-- Derived history stays separate from observed account snapshots.
CREATE TABLE IF NOT EXISTS portfolio_reconstructed_values (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_identifier TEXT NOT NULL,
 value_date DATE NOT NULL,
 holdings_usd NUMERIC(20,6), cash_usd NUMERIC(20,6), stablecoins_usd NUMERIC(20,6),
 gbp_per_usd NUMERIC(20,10),
 issues JSONB NOT NULL DEFAULT '[]',
 method TEXT NOT NULL,
 reconstructed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(user_id,account_identifier,value_date)
);
CREATE TABLE IF NOT EXISTS portfolio_reconstruction_prices (
 symbol TEXT PRIMARY KEY, payload JSONB NOT NULL, fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS portfolio_statement_values (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_identifier TEXT NOT NULL, value_date DATE NOT NULL,
 holdings_usd NUMERIC(20,6) NOT NULL, cash_usd NUMERIC(20,6) NOT NULL,
 stablecoins_usd NUMERIC(20,6) NOT NULL DEFAULT 0, gbp_per_usd NUMERIC(20,10),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(user_id,account_identifier,value_date)
);
