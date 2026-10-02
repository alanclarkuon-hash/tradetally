-- Preserve both upstream forex and fork historical CFD imports, including
-- fresh installations where the earlier CFD migration runs after forex.
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_instrument_type_check;
ALTER TABLE trades ADD CONSTRAINT trades_instrument_type_check
CHECK (instrument_type IN ('stock','option','future','crypto','cfd','forex'));
