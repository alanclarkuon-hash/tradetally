-- Instrument identity metadata only; broker financial source records remain unchanged.
CREATE TABLE IF NOT EXISTS broker_instrument_catalogues (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 broker_type TEXT NOT NULL,
 account_identifier TEXT NOT NULL,
 instruments JSONB NOT NULL CHECK (jsonb_typeof(instruments)='array'),
 fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (user_id,broker_type,account_identifier)
);
