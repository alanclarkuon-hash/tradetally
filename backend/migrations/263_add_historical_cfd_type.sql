-- Preserve historical copied CFD trades as CFDs, rather than stocks.
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_instrument_type_check;
ALTER TABLE trades ADD CONSTRAINT trades_instrument_type_check
CHECK (instrument_type IN ('stock','option','future','crypto','cfd'));
