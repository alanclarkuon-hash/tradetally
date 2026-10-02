-- Read-only eToro credentials and a private staging area for initial imports.
ALTER TABLE broker_connections DROP CONSTRAINT IF EXISTS broker_connections_broker_type_check;
ALTER TABLE broker_connections ADD CONSTRAINT broker_connections_broker_type_check
CHECK (broker_type IN ('ibkr','schwab','tradestation','alpaca','trading212','etoro'));
ALTER TABLE broker_connections ADD COLUMN IF NOT EXISTS etoro_api_key TEXT,
ADD COLUMN IF NOT EXISTS etoro_user_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connections_user_etoro_environment
ON broker_connections(user_id, COALESCE(broker_environment,'real')) WHERE broker_type='etoro';
CREATE TABLE IF NOT EXISTS broker_import_snapshots (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_type TEXT NOT NULL,
  account_identifier TEXT NOT NULL,
  connection_id UUID REFERENCES broker_connections(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(user_id,broker_type,account_identifier)
);
COMMENT ON COLUMN broker_connections.etoro_api_key IS 'Encrypted eToro public API key';
COMMENT ON COLUMN broker_connections.etoro_user_key IS 'Encrypted eToro user key';
