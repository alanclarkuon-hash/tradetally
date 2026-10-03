# Transfers between brokers

Broker Sync shows private audit links between external crypto movements. After
Kraken or OKX sync, matching runs locally using saved native history, without
additional broker API requests. The authenticated `/api/broker-sync/transfers`
endpoint lists only the requesting user's links and unmatched movement summaries.

Currently supported: Kraken crypto withdrawals to completed OKX deposits. Amounts
must match exactly at native precision, with the same coin, within 15 minutes
(up to one minute of clock skew). Both legs must have exactly one candidate.
The UI labels this amount/time evidence; blockchain transaction IDs are not
independently verified. Kraken debits withdrawal principal plus its separate fee.
OKX internal Funding/Trading wallet movements and pending deposits are excluded.

Links are stored separately from imports with unique owner/account/reference
constraints. Repeated syncs cannot create duplicate links. Changed linked records
block updates for review. Missing older records do not delete saved links.

This is transfer classification, not a cost-basis reconstruction. It creates no
cash deposits, income, sales or journal entries and changes no holdings or realised
P&L. Existing receipt-date performance values stay in place; original acquisition
cost is not inferred from matching. Fees are displayed for audit without posting
them again because the native ledger already debited them.

eToro USD-to-GBP cash transfers do not establish crypto withdrawals. Its crypto
wallet history or evidence of intermediary conversions is needed to connect those
movements to another broker. No private examples or statements belong in Git.
