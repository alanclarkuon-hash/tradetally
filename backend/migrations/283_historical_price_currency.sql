ALTER TABLE historical_prices ADD COLUMN IF NOT EXISTS price_currency TEXT;
UPDATE historical_prices SET price_currency='USD'
WHERE price_currency IS NULL AND (data_source IN ('reconstruction_cache','coingecko','okx','kraken') OR data_source LIKE 'broker:%');
-- Native provider units without recorded evidence remain unknown until refreshed.
