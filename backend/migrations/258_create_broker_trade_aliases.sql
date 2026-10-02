-- Keep links to repaired import artefacts pointing at the real trade.
CREATE TABLE IF NOT EXISTS broker_trade_aliases (
  source_trade_id UUID PRIMARY KEY,
  target_trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
