ALTER TABLE broker_connections DROP CONSTRAINT IF EXISTS broker_connections_broker_type_check;
ALTER TABLE broker_connections ADD CONSTRAINT broker_connections_broker_type_check
  CHECK(broker_type IN ('ibkr','schwab','tradestation','alpaca','trading212','etoro','okx','kraken'));
ALTER TABLE broker_connections ADD COLUMN IF NOT EXISTS kraken_api_key TEXT,
  ADD COLUMN IF NOT EXISTS kraken_api_secret TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connections_user_kraken
  ON broker_connections(user_id) WHERE broker_type='kraken';
-- Persist nonces across app restarts and clock corrections. No keys are stored
-- here: the key_hash is a SHA256 fingerprint of the public API key.
CREATE TABLE IF NOT EXISTS kraken_api_nonces (
  key_hash TEXT PRIMARY KEY,
  last_nonce NUMERIC(20,0) NOT NULL
);
COMMENT ON COLUMN broker_connections.kraken_api_key IS 'Encrypted Kraken public API key';
COMMENT ON COLUMN broker_connections.kraken_api_secret IS 'Encrypted Kraken signing secret';
