-- Keep main and subaccount connections separate by validated native account UID.
DROP INDEX IF EXISTS idx_broker_connections_user_okx_region;
CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connections_user_okx_account
 ON broker_connections(user_id,COALESCE(broker_environment,'global'),external_account_id)
 WHERE broker_type='okx';
