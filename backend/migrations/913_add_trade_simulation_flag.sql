-- Cashflow excludes explicitly simulated trades. The v2.14 queries require
-- this flag on both fresh installations and upgraded databases.
-- A constant FALSE default keeps existing broker/source trades real without
-- rewriting their stored prices, costs, quantities, fills or profit.
SET LOCAL lock_timeout = '3s';
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS is_simulated BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN trades.is_simulated IS
  'Explicit simulation marker; simulated trades are excluded from brokerage account cashflow';
