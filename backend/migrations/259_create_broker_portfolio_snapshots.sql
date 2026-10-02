CREATE TABLE IF NOT EXISTS broker_portfolio_snapshots (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_type TEXT NOT NULL,
  account_identifier TEXT NOT NULL,
  connection_id UUID REFERENCES broker_connections(id) ON DELETE SET NULL,
  positions JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id, broker_type, account_identifier)
);
