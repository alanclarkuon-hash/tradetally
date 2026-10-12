-- Broker quote sources include the broker and instrument class. Keep the
-- complete identity instead of truncating it or dropping successful quotes.
-- Save the dependent view definition so this migration preserves the installed
-- alert identity rules rather than replacing them with an older definition.
DO $$
DECLARE alert_view TEXT;
BEGIN
  SELECT pg_get_viewdef('active_alerts_with_prices'::regclass, true) INTO alert_view;
  DROP VIEW active_alerts_with_prices;
  ALTER TABLE price_monitoring ALTER COLUMN data_source TYPE TEXT;
  EXECUTE 'CREATE VIEW active_alerts_with_prices AS ' || alert_view;
END $$;
