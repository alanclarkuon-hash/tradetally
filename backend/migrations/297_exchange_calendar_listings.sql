-- Public instrument listing metadata, independent of asset classification.
CREATE TABLE IF NOT EXISTS exchange_calendar_listings (
  symbol TEXT PRIMARY KEY,
  exchange TEXT NOT NULL,
  source TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
