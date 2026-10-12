-- Planning is separate from imported financial records. Issue #23.
ALTER TABLE playbooks ADD COLUMN IF NOT EXISTS planning_template JSONB;
CREATE TABLE IF NOT EXISTS trade_plans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 playbook_id UUID REFERENCES playbooks(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','watching','ready','cancelled')),
 definition JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trade_plans_user_updated ON trade_plans(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS trade_plan_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), plan_id UUID NOT NULL REFERENCES trade_plans(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_type TEXT NOT NULL,
 snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS trade_plan_commitments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), plan_id UUID NOT NULL REFERENCES trade_plans(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, account_id UUID NOT NULL REFERENCES user_accounts(id),
 stage_key TEXT NOT NULL, currency TEXT NOT NULL, risk_amount NUMERIC(20,8) NOT NULL CHECK(risk_amount > 0),
 snapshot JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','released')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), released_at TIMESTAMPTZ, release_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS trade_plan_active_commitment ON trade_plan_commitments(plan_id,stage_key) WHERE status='reserved';
CREATE INDEX IF NOT EXISTS trade_plan_commitments_user ON trade_plan_commitments(user_id,status);