ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_instrument_type_check;
ALTER TABLE trades ADD CONSTRAINT trades_instrument_type_check
CHECK (instrument_type IN ('stock','option','future','crypto','cfd','forex','spread_bet'));

ALTER TABLE broker_cash_events DROP CONSTRAINT IF EXISTS broker_cash_events_event_type_check;
ALTER TABLE broker_cash_events ADD CONSTRAINT broker_cash_events_event_type_check
CHECK (event_type IN ('deposit','withdrawal','dividend','interest','account_fee','tax','transfer_in','transfer_out'));
