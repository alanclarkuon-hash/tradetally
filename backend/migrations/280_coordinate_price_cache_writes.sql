ALTER TABLE historical_prices ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ;
-- Earlier live quote writers uppercased the entire crypto cache identity.
-- Retain finalized data ahead of provisional duplicates, then canonicalize.
DELETE FROM historical_prices lower_row USING historical_prices upper_row
WHERE upper_row.symbol LIKE 'CRYPTO:%'
  AND lower_row.symbol='crypto:' || substring(upper_row.symbol FROM 8)
  AND lower_row.price_date=upper_row.price_date
  AND upper_row.is_final AND NOT lower_row.is_final;
DELETE FROM historical_prices upper_row USING historical_prices lower_row
WHERE upper_row.symbol LIKE 'CRYPTO:%'
  AND lower_row.symbol='crypto:' || substring(upper_row.symbol FROM 8)
  AND lower_row.price_date=upper_row.price_date;
UPDATE historical_prices SET symbol='crypto:' || substring(symbol FROM 8)
WHERE symbol LIKE 'CRYPTO:%';

CREATE OR REPLACE VIEW active_alerts_with_prices AS
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
   WHERE cq.symbol='crypto:' || pa.symbol
     AND (cq.data_source='coingecko' OR cq.data_source ~ '^broker:[^:]+:crypto$')), pa.symbol)
WHERE pa.is_active=TRUE AND u.tier='pro';
