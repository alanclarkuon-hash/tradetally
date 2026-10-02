ALTER TABLE broker_cash_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE broker_cash_events DROP CONSTRAINT IF EXISTS broker_cash_events_event_type_check;
ALTER TABLE broker_cash_events ADD CONSTRAINT broker_cash_events_event_type_check
  CHECK(event_type IN ('deposit','withdrawal','dividend','interest','account_fee','tax','corporate_action'));
