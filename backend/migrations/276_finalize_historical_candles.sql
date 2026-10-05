-- Live quotes are provisional. The next history backfill supplies a finalized
-- daily close; finalized rows remain immutable and never expire.
ALTER TABLE historical_prices ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE historical_prices SET is_final=FALSE WHERE price_date >= CURRENT_DATE;
