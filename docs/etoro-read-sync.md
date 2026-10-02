# eToro read connection

Broker Sync accepts a real-account Public API Key and User Key created with Read All permissions. Both are encrypted in the database and excluded from connection API responses. The connector only calls fixed GET endpoints and does not follow redirects with credential headers.

The initial implementation downloads a private review snapshot. It does **not** create journal trades, report holdings, cashflow events or income. The connection card and sync warnings explain this state; automatic syncing cannot be enabled while `import_pending_review` is set. A subsequent import implementation must reconcile the verified snapshot before clearing that flag.

The snapshot contains portfolio/PnL data, direct and copied positions, recent closed trades and instrument metadata. It is stored in `broker_import_snapshots`, separate from report tables. Account identity is checked on each sync, and incomplete responses leave the previous snapshot intact. Personal profile fields from `/me` and API credentials are never included in snapshots.

History requests use a maximum lookback of 364 days and bounded pagination. Partial closes retain separate order/timestamp/quantity identities. The documentation describes successive historical windows but exposes only `minDate`, with no end-date parameter; older history is not claimed to be complete. Account statements may be needed for earlier trades and cash transactions.

Before importing, verify the actual API shape, account currency, instrument classifications, native price conversion rates, leveraged/CFD positions, closing slices and copied-trade identities. Keep source payloads and account figures in the private application data only. GBP display conversion should use the application's existing currency handling after amounts have been reconciled in the account currency.

Official references:

- [Authentication and API keys](https://builders.etoro.com/learn/authentication-and-api-keys)
- [Real account history](https://api-portal.etoro.com/api-reference/trading--real/list-trading-history)
- [Real portfolio and PnL](https://api-portal.etoro.com/api-reference/trading--real/get-account-pnl-and-portfolio-details)

Validation: service tests cover safe GET requests, secret redaction, partial closes, copied positions, incomplete fetches, identity changes and snapshot ownership. Model tests cover encryption and credential-free responses.
