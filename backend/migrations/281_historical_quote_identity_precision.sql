-- Match the current quote cache: crypto namespaces and sub-cent tokens must
-- remain usable when a current quote contributes a provisional daily value.
ALTER TABLE historical_prices ALTER COLUMN symbol TYPE VARCHAR(128);
ALTER TABLE historical_prices ALTER COLUMN open TYPE NUMERIC(38,18);
ALTER TABLE historical_prices ALTER COLUMN high TYPE NUMERIC(38,18);
ALTER TABLE historical_prices ALTER COLUMN low TYPE NUMERIC(38,18);
ALTER TABLE historical_prices ALTER COLUMN close TYPE NUMERIC(38,18);
