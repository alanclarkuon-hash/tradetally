-- Crypto quote identities have a namespace prefix and may have long tickers.
-- Retain sub-cent token prices without the equity cache's four-decimal rounding.
ALTER TABLE price_monitoring ALTER COLUMN symbol TYPE VARCHAR(128);
ALTER TABLE price_monitoring ALTER COLUMN current_price TYPE NUMERIC(38,18);
ALTER TABLE price_monitoring ALTER COLUMN previous_price TYPE NUMERIC(38,18);
ALTER TABLE price_monitoring ALTER COLUMN price_change TYPE NUMERIC(38,18);
ALTER TABLE price_monitoring ALTER COLUMN high_of_day TYPE NUMERIC(38,18);
ALTER TABLE price_monitoring ALTER COLUMN low_of_day TYPE NUMERIC(38,18);
ALTER TABLE price_monitoring ALTER COLUMN open_price TYPE NUMERIC(38,18);
