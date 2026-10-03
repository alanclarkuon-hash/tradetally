ALTER TABLE broker_connections DROP CONSTRAINT IF EXISTS broker_connections_broker_type_check;
ALTER TABLE broker_connections ADD CONSTRAINT broker_connections_broker_type_check
  CHECK(broker_type IN ('ibkr','schwab','tradestation','alpaca','trading212','etoro','okx','kraken','ig'));
ALTER TABLE broker_connections ADD COLUMN IF NOT EXISTS ig_api_key TEXT,
  ADD COLUMN IF NOT EXISTS ig_username TEXT,
  ADD COLUMN IF NOT EXISTS ig_password TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connections_user_ig
  ON broker_connections(user_id,(COALESCE(broker_environment,'live'))) WHERE broker_type='ig';
COMMENT ON COLUMN broker_connections.ig_api_key IS 'Encrypted IG application API key';
COMMENT ON COLUMN broker_connections.ig_username IS 'Encrypted IG login identifier';
COMMENT ON COLUMN broker_connections.ig_password IS 'Encrypted IG login password; session tokens are never persisted';
