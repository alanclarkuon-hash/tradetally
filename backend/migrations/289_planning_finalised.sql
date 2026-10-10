-- Finalisation is preparation evidence, not a lifecycle stage.
ALTER TABLE trade_plans ADD COLUMN IF NOT EXISTS finalised BOOLEAN NOT NULL DEFAULT false;
UPDATE trade_plans SET finalised=true WHERE status IN ('ready','entered','under_review','reviewed','completed');
UPDATE trade_plans SET status='draft',version=version+1,updated_at=NOW() WHERE status='ready';
ALTER TABLE trade_plans DROP CONSTRAINT IF EXISTS trade_plans_status_check;
ALTER TABLE trade_plans ADD CONSTRAINT trade_plans_status_check
 CHECK(status IN ('draft','watching','entered','under_review','reviewed','completed','cancelled'));
