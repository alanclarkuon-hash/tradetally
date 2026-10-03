# OKX read-only connection

Create an OKX API key with Read permission only. Trade and Withdraw must be disabled. Enter its key, secret and API passphrase in Broker Sync, never in chat or Git. Credentials are encrypted in the database and excluded from connection responses. Global/UK, EEA and US/Australia origins are fixed allowlisted regions; authenticated redirects are disabled.

The initial connector validates the account UID and permissions, then downloads Trading and Funding balances, positions, spot fills, account bills and recent deposit/withdrawal records into a private owner-scoped import snapshot. No journal trades, holdings or funding payments are created yet. Auto-sync remains disabled until reconciliation is implemented and the first account snapshot is checked. The connection card explicitly displays this pending state.

Spot fills and regular archived bills cover three months. Quarterly bill archives are available from February 2021 except the current quarter, through a separate report workflow. Do not infer historical cost basis from an incomplete fill window or treat crypto transfers as buys and sells. Crypto-denominated fees and transfers must be reconciled in their native assets before conversion to reporting currency. The initial transfer snapshot contains up to 100 deposits and 100 withdrawals and marks possible truncation explicitly.

All authenticated requests are fixed GET endpoints with HMAC-SHA256 signatures over the timestamp, GET method and exact encoded request path. Error messages discard Axios request data and arbitrary broker messages to avoid exposing credentials. History pagination is bounded and uses stable bill IDs.

Reference: [official OKX API documentation](https://www.okx.com/docs-v5).
