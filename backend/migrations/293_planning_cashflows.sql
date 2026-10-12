-- Cash sources remain broker-owned; only explicit plan attribution is stored here.
CREATE TABLE IF NOT EXISTS trade_plan_cashflow_links (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id UUID NOT NULL REFERENCES trade_plans(id) ON DELETE CASCADE,
 cash_event_id UUID REFERENCES broker_cash_events(id) ON DELETE SET NULL,
 source_key TEXT NOT NULL,
 fraction NUMERIC(12,10) NOT NULL CHECK(fraction>0 AND fraction<=1),
 treatment TEXT NOT NULL CHECK(treatment IN ('include','already_included','exclude')),
 reason TEXT NOT NULL,
 source_snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(user_id,plan_id,source_key)
);
CREATE INDEX IF NOT EXISTS trade_plan_cashflow_source ON trade_plan_cashflow_links(user_id,cash_event_id);
