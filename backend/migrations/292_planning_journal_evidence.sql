-- Immutable entry assessment snapshots. Diary edits/deletion never rewrite them.
CREATE TABLE IF NOT EXISTS trade_plan_journal_assessments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),plan_id UUID NOT NULL REFERENCES trade_plans(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,stage_key TEXT NOT NULL,
 account_id UUID REFERENCES user_accounts(id),diary_entry_id UUID REFERENCES diary_entries(id) ON DELETE SET NULL,
 session_date DATE NOT NULL,snapshot JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS trade_plan_journal_assessments_owner ON trade_plan_journal_assessments(user_id,plan_id,stage_key,created_at);
ALTER TABLE trade_plan_allocations ADD COLUMN IF NOT EXISTS journal_evidence JSONB;
