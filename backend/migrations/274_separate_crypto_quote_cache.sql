-- Crypto quote identities have a namespace prefix and may have long tickers.
-- Retain sub-cent token prices without the equity cache's four-decimal rounding.
DROP VIEW IF EXISTS active_alerts_with_prices;
ALTER TABLE price_monitoring ALTER COLUMN symbol TYPE VARCHAR(128);
ALTER TABLE price_monitoring ALTER COLUMN current_price TYPE NUMERIC(38,18);
ALTER TABLE price_monitoring ALTER COLUMN previous_price TYPE NUMERIC(38,18);
ALTER TABLE price_monitoring ALTER COLUMN price_change TYPE NUMERIC(38,18);
ALTER TABLE price_monitoring ALTER COLUMN high_of_day TYPE NUMERIC(38,18);
ALTER TABLE price_monitoring ALTER COLUMN low_of_day TYPE NUMERIC(38,18);
ALTER TABLE price_monitoring ALTER COLUMN open_price TYPE NUMERIC(38,18);

CREATE VIEW active_alerts_with_prices AS
SELECT pa.id, pa.user_id, pa.symbol, pa.alert_type, pa.target_price,
       pa.change_percent, pa.current_price AS alert_creation_price,
       pa.email_enabled, pa.browser_enabled, pa.repeat_enabled, pa.created_at,
       pm.current_price, pm.percent_change, pm.last_updated AS price_last_updated,
       u.email, us.email_notifications AS user_email_enabled
FROM price_alerts pa
JOIN users u ON pa.user_id=u.id
LEFT JOIN user_settings us ON us.user_id=u.id
LEFT JOIN price_monitoring pm ON pm.symbol=COALESCE(
  (SELECT cq.symbol FROM price_monitoring cq
   WHERE cq.symbol='crypto:' || pa.symbol AND cq.data_source='coingecko'), pa.symbol)
WHERE pa.is_active=TRUE AND u.tier='pro';
