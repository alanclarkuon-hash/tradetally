-- Rebuildable reporting cache only. No source trade/statement writes or triggers.
CREATE TABLE IF NOT EXISTS trade_account_reports (
 trade_id UUID PRIMARY KEY REFERENCES trades(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_signature TEXT NOT NULL,
 result JSONB NOT NULL,
 calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trade_account_reports_user ON trade_account_reports(user_id);
CREATE OR REPLACE FUNCTION trade_account_report_usd(trade_key UUID, field TEXT) RETURNS NUMERIC LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN result->>'status'!='complete' THEN NULL
 WHEN result->>'currency'='USD' THEN (result->>field)::numeric
 ELSE (result->>field)::numeric / NULLIF((SELECT (rates->>(result->>'currency'))::numeric FROM fx_daily_rates WHERE base_code='USD' ORDER BY rate_date DESC LIMIT 1),0) END
 FROM trade_account_reports WHERE trade_id=trade_key
$$;
DELETE FROM analytics_cache;
