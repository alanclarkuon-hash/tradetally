CREATE TABLE IF NOT EXISTS ig_statement_cash_coverage (
 receipt_id UUID PRIMARY KEY REFERENCES ig_statement_ingestion(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_identifier TEXT NOT NULL,
 statement_date DATE NOT NULL,
 currency TEXT NOT NULL CHECK(currency='GBP'),
 reported_cash NUMERIC(20,2) NOT NULL,
 calculated_cash NUMERIC(20,2) NOT NULL,
 unitemised_cash NUMERIC(20,2) NOT NULL,
 verified_through TIMESTAMPTZ NOT NULL,
 CHECK(unitemised_cash=reported_cash-calculated_cash)
);
CREATE INDEX IF NOT EXISTS ig_cash_coverage_account_date ON ig_statement_cash_coverage(user_id,account_identifier,statement_date);
