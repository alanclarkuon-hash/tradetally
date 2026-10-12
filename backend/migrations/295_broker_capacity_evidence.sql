CREATE TABLE IF NOT EXISTS broker_capacity_evidence (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
 broker_type TEXT NOT NULL,currency TEXT NOT NULL,available_cash NUMERIC NOT NULL CHECK(available_cash>=0),
 source TEXT NOT NULL,as_of TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(user_id,account_id,broker_type)
);
