-- Quote writers supply UTC ISO timestamps. The former timezone-less column
-- discarded the offset, then Node interpreted those values in its local zone.
-- Preserve the existing UTC clock readings and all dependent alert view rules.
DO $$
DECLARE alert_view TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='price_monitoring'
        AND column_name='last_updated' AND data_type='timestamp without time zone') THEN
    SELECT pg_get_viewdef('active_alerts_with_prices'::regclass, true) INTO alert_view;
    DROP VIEW active_alerts_with_prices;
    ALTER TABLE price_monitoring ALTER COLUMN last_updated TYPE TIMESTAMPTZ
      USING last_updated AT TIME ZONE 'UTC';
    EXECUTE 'CREATE VIEW active_alerts_with_prices AS ' || alert_view;
  END IF;
END $$;
