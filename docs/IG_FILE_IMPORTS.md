# IG file imports

IG uses files only; this integration never stores an IG password or calls the trading API.
Each spread betting and share dealing account remains separate and reports native GBP cash.

Export full account history on each import. Spread betting requires Transactions, Past activity and P&L Breakdown CSVs. Share dealing requires Transactions CSV and the holdings/cash statement. Keep the monthly ledger PDF and trading statement PDF as private reconciliation evidence. Statement cutoffs may precede interest payments present in the CSV.

The operator prepares a private JSON array of account inputs for `backend/scripts/import-ig-statements.js`. Each input has `name`, a stable account `identity`, `kind` (`spread_bet` or `share_dealing`), CSV text in `transactions`, and `confirmation` containing verified `cash`, UTC `cutoff` and `holdings`. Spread betting also supplies `breakdown` and `activity`. Share holdings contain `name`, `symbol`, `isin`, `quantity`, `cost`, `value` and dated `asOf`. These confirmations must come from inspected statements, never inferred current quotes. Keep input files outside Git; inside Docker use the private application data volume.

Run with `PRIVATE_JSON USER_ID --dry-run` first, then `--apply` after a database backup. The dry run rolls back accounts, trades, cash events, transfer links and portfolio snapshots. Historical FX rates may be cached separately. A repeat import skips matching records; changed financial records, missing full history, ambiguous transfers, missing FX, unsupported transaction categories or unreconciled balances stop the whole import. Future share trade history and open spread bets need additional parser support and are deliberately rejected until supported.

Spread-bet quantity means GBP stake per point. Cashflow uses actual cash settlements rather than price times stake. Journal P&L includes broker-reported funding, borrowing and stop fees; dividends and cash interest are separate income. Internal transfers affect each account cash balance but never external deposits, withdrawals or income. Unique simultaneous transfers are matched first; remaining unique opposite entries can match across an overnight posting delay of up to 24 hours. Holdings use dated statement valuations, not live prices.
