-- Preserve broker grouping alongside explicit owner corrections.
ALTER TABLE trades ADD COLUMN IF NOT EXISTS matching_baseline JSONB;
CREATE TABLE IF NOT EXISTS detached_trade_exits (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 origin_trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
 assigned_trade_id UUID REFERENCES trades(id) ON DELETE RESTRICT,
 execution JSONB NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS detached_trade_exits_owner ON detached_trade_exits(user_id,origin_trade_id);
CREATE TABLE IF NOT EXISTS trade_exit_matching_history (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 exit_id UUID NOT NULL REFERENCES detached_trade_exits(id) ON DELETE CASCADE,
 from_trade_id UUID REFERENCES trades(id) ON DELETE RESTRICT,
 to_trade_id UUID REFERENCES trades(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
