ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD';

CREATE TABLE IF NOT EXISTS broker_cash_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  broker_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('deposit','withdrawal','dividend','interest','account_fee','tax')),
  event_date DATE NOT NULL,
  amount NUMERIC(20,8) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  amount_usd NUMERIC(20,8) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,account_id,broker_type,reference_id)
);
CREATE INDEX IF NOT EXISTS idx_broker_cash_events_account_date ON broker_cash_events(user_id,account_id,event_date);
