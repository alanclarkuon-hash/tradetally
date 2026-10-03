-- Private audit links only: no cash, income, trade or cost-basis postings.
CREATE TABLE IF NOT EXISTS broker_transfer_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_broker TEXT NOT NULL,
  source_account TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  destination_broker TEXT NOT NULL,
  destination_account TEXT NOT NULL,
  destination_reference TEXT NOT NULL,
  asset TEXT NOT NULL,
  quantity NUMERIC(36,16) NOT NULL CHECK(quantity > 0),
  source_fee NUMERIC(36,16) NOT NULL CHECK(source_fee >= 0),
  sent_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  match_method TEXT NOT NULL CHECK(match_method = 'unique_amount_time'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, source_broker, source_account, source_reference),
  UNIQUE(user_id, destination_broker, destination_account, destination_reference)
);
