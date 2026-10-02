CREATE TABLE IF NOT EXISTS broker_cash_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  broker_type TEXT NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL CHECK(to_date >= from_date),
  currency VARCHAR(3) NOT NULL,
  starting_cash NUMERIC(24,10) NOT NULL,
  ending_cash NUMERIC(24,10) NOT NULL,
  records JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,account_id,broker_type,from_date,to_date)
);
