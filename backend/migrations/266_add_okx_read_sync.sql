ALTER TABLE broker_connections DROP CONSTRAINT IF EXISTS broker_connections_broker_type_check;
ALTER TABLE broker_connections ADD CONSTRAINT broker_connections_broker_type_check
  CHECK(broker_type IN ('ibkr','schwab','tradestation','alpaca','trading212','etoro','okx'));
ALTER TABLE broker_connections ADD COLUMN IF NOT EXISTS okx_api_key TEXT,
  ADD COLUMN IF NOT EXISTS okx_api_secret TEXT,
  ADD COLUMN IF NOT EXISTS okx_passphrase TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connections_user_okx_region
  ON broker_connections(user_id,COALESCE(broker_environment,'global')) WHERE broker_type='okx';
