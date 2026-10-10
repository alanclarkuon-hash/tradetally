
ALTER TABLE trade_plans DROP CONSTRAINT IF EXISTS trade_plans_status_check;
ALTER TABLE trade_plans ADD CONSTRAINT trade_plans_status_check
 CHECK(status IN ('draft','watching','ready','entered','under_review','reviewed','completed','cancelled'));
ALTER TABLE trade_plans ADD COLUMN IF NOT EXISTS baseline JSONB;
ALTER TABLE trade_plans ADD COLUMN IF NOT EXISTS review JSONB;
CREATE TABLE IF NOT EXISTS trade_plan_allocations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id UUID NOT NULL REFERENCES trade_plans(id) ON DELETE CASCADE,
 trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
 source_key TEXT NOT NULL, stage_key TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('entry','exit')),
 quantity NUMERIC(20,8) NOT NULL CHECK(quantity>0),
 source_snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(plan_id,stage_key,trade_id,source_key)
);
CREATE INDEX IF NOT EXISTS trade_plan_allocations_owner ON trade_plan_allocations(user_id,trade_id,source_key);
CREATE TABLE IF NOT EXISTS trade_plan_tags (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('entry','exit','context')),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 definition TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(user_id,kind,name)
);
CREATE TABLE IF NOT EXISTS trade_planning_settings (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 settings JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trade_plans ADD COLUMN IF NOT EXISTS management JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS trade_plan_charts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), plan_id UUID NOT NULL REFERENCES trade_plans(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, source_url TEXT NOT NULL,
 sha256 TEXT NOT NULL, image BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(plan_id,source_url)
);
