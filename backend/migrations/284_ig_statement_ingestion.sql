CREATE TABLE IF NOT EXISTS ig_statement_ingestion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attachment_hash TEXT NOT NULL CHECK (attachment_hash ~ '^[a-f0-9]{64}$'),
  statement_date DATE,
  account_identifier TEXT,
  status TEXT NOT NULL CHECK(status IN ('processing','imported','duplicate','conflict','review','rejected')),
  reason TEXT,
  evidence JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(user_id,attachment_hash)
);
CREATE INDEX IF NOT EXISTS ig_ingestion_user_status ON ig_statement_ingestion(user_id,status,received_at DESC);
