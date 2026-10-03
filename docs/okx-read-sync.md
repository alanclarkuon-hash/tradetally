# OKX read-only connection

Create an OKX API key with Read permission only. Trade and Withdraw must be disabled. Enter its key, secret and API passphrase in Broker Sync, never in chat or Git. Credentials are encrypted in the database and excluded from connection responses. Global/UK, EEA and US/Australia origins are fixed allowlisted regions; authenticated redirects are disabled.

The first sync downloads a private snapshot for review. After reconciliation, subsequent syncs atomically rebuild fee-adjusted spot FIFO lots, import journal trades, update authoritative holdings and retain old fills and bills outside the API window. Existing closed identities cannot disappear; unknown bills, missing rates, missing cost basis and unreconciled balances stop the import and preserve previous reports. Daily autosync can then be enabled.

USDT is a crypto holding, not fiat cash. USD is the managed account's reporting currency. Historical conversion uses OKX's USDT/USD daily UTC index, with the current wallet's reported USD valuation for the current date. Native prices, quantities and fees remain in private execution metadata. The USD profit includes exchange-rate changes between acquisition and disposal, so it can differ from native USDT profit. GBP display uses TradeTally's existing conversion. Fees are embedded in net quantities and settlement prices and are not charged a second time.

All current coins, including USDT, appear in Holdings. Stablecoin performance basis values incoming transfers at the transfer-date index; it is not the original tax basis from the sending wallet. Account & Cashflow explicitly labels the USDT wallet as a USD-equivalent asset valuation, tracks index revaluation separately, and excludes transfers from deposits and income. The wallet is already included in holdings and must not be added to portfolio value again.

The current importer supports reconciled spot/USDT histories with zero Funding wallet balance and Trading-wallet transfer bills. Other quote assets, derivative positions, Funding balances and unrecognised bills require an extension; they fail closed instead of silently producing partial totals.

Spot fills and regular archived bills cover three months. Quarterly bill archives are available from February 2021 except the current quarter, through a separate report workflow. Do not infer historical cost basis from an incomplete fill window or treat crypto transfers as buys and sells. Crypto-denominated fees and transfers must be reconciled in their native assets before conversion to reporting currency. The initial transfer snapshot contains up to 100 deposits and 100 withdrawals and marks possible truncation explicitly.

All authenticated requests are fixed GET endpoints with HMAC-SHA256 signatures over the timestamp, GET method and exact encoded request path. Error messages discard Axios request data and arbitrary broker messages to avoid exposing credentials. History pagination is bounded and uses stable bill IDs.

Reference: [official OKX API documentation](https://www.okx.com/docs-v5).
