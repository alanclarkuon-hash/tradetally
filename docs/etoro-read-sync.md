# eToro read connection

Broker Sync accepts a real-account Public API Key and User Key created with Read All permissions. Both are encrypted in the database and excluded from connection API responses. The connector only calls fixed GET endpoints and does not follow redirects with credential headers.

New connections download a private review snapshot first. Automatic syncing cannot be enabled while `import_pending_review` is set. After the initial snapshot has been verified, `etoroReconcile.reconcile` imports journal trades and an authoritative holdings snapshot atomically and clears that flag. Subsequent syncs reconcile newly downloaded data automatically. Cashflow and income are not imported by these portfolio/history endpoints.

The snapshot contains portfolio/PnL data, direct and copied positions, recent closed trades and instrument metadata. It is stored in `broker_import_snapshots`, separate from report tables. Account identity is checked on each sync, and incomplete responses leave the previous snapshot intact. Personal profile fields from `/me` and API credentials are never included in snapshots.

History requests use a maximum lookback of 364 days and bounded pagination. Partial closes retain separate order/timestamp/quantity identities. The documentation describes successive historical windows but exposes only `minDate`, with no end-date parameter; older history is not claimed to be complete. Account statements may be needed for earlier trades and cash transactions.

The importer supports unleveraged long stock/ETF/crypto holdings and unleveraged closed trades. Open lots use remaining units and `unitsBaseValueDollars`, checked against native opening price and broker FX. Closed history lacks FX: its USD investment must match opening price times units before importing. Net profit is preserved as reported; fees can be informational or already included. Unsupported leverage, unknown currency, conflicting identities or disappearing open lots stop the import for review. Closed trades outside the rolling API window are retained. Exact broker identities prevent duplicates after reconnecting, and full closures preserve former open trade IDs and user notes.

Keep source payloads and account figures in private application data only. GBP display conversion uses existing application currency handling after reconciliation in USD. Dashboard and holdings use the broker snapshot, including crypto, instead of rebuilding current quantities from incomplete historical trades.

Official references:

- [Authentication and API keys](https://builders.etoro.com/learn/authentication-and-api-keys)
- [Real account history](https://api-portal.etoro.com/api-reference/trading--real/list-trading-history)
- [Real portfolio and PnL](https://api-portal.etoro.com/api-reference/trading--real/get-account-pnl-and-portfolio-details)

Validation: service tests cover safe GET requests, secret redaction, partial closes, copied positions, incomplete fetches, identity changes and snapshot ownership. Model tests cover encryption and credential-free responses.

## Historical account statements

Read the XLSX from its original private location with `backend/scripts/read_etoro_statement.py` and pipe the extracted JSON directly into private application data. Never save source statements or extracted rows as tracked fixtures. Account-statement filenames are ignored by Git as an additional safeguard.

`etoroStatement.importClosedPositions` imports the Closed Positions sheet after a dry run and backup. It preserves Stocks/ETF, Crypto and CFD classifications, copied origin and leverage metadata, native rates, stated FX and authoritative USD profit. It supports legitimate zero-price delistings and zero-capital corporate allocations. Overlap matching uses position identity, symbol, quantities, profit and timestamps rounded to seconds; conflicting overlaps stop the transaction. Batched inserts retain existing API trade IDs. Repeated imports do not duplicate records.

If the statement explicitly supplies zero opening FX, its reported USD invested capital times leverage divided by units supplies the USD unit cost basis. A trade note and execution metadata distinguish this from a broker quoted price. The missing FX remains null and the native price is retained. Closing FX must still be supplied. Reported profit is preserved independently of rounded historical prices.

Historical Holdings sheets are periodic snapshots and are not imported as current holdings. Current API holdings remain authoritative. Account Activity and Dividends are kept privately for a separate cashflow/income reconciliation; they are not implicitly added again to closed-trade profit.

## Statement cash and income

`etoroCashStatement` imports USD Account Activity into a matching managed USD account after backup. Dividend details classify matching overnight rows as dividends using date, position and rounded USD amount, consuming one activity occurrence per detail. Extra detail rows are reported for review and never create cash. Negative activity dividend adjustments remain negative income. Interest and staking are income; genuine overnight fees/refunds, trading spread charges and SDRT retain their signed amounts. Net dividends already reflect withholding, so withholding is not deducted again.

The cash ledger uses successive reported Balance differences, not position notional values or dividend detail totals. It preserves cash movements into and out of historical copied investments and explicitly labels the balance as a statement balance. Income credited inside copied investments can differ from free-wallet cash movement. Journal profit is not modified by this import. Repeating the same statement uses hashed source identities plus occurrence counts to avoid duplicate payments.

USD and GBP eToro accounts are separate. Withdrawal requests can be reversed; conversion-fee activity rows can carry the entire settlement in their Balance rather than the small fee shown in Amount. These rows are retained in the ledger but are not automatically imported as external withdrawals or additional account fees. Funding remains marked pending until the GBP account history reconciles actual bank withdrawals and inter-account transfers. GBP balances are not inferred from USD transfers. Statement income and cash are not claimed to be refreshed by the trading API.
