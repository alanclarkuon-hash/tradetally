# IG spread betting and share dealing

The first IG integration downloads spread-betting history into private
`broker_import_snapshots`. It does not import financial records yet. Scheduled
imports remain disabled until live data, stake units, fee treatment, currencies,
partial closures and historical coverage have been reconciled.

IG API credentials include an application key, login identifier and password.
All three are encrypted using the existing credential service. API responses
omit credentials. OAuth tokens and refresh tokens are held in memory only and
never saved in snapshots. IG credentials can permit dealing; the connector
restricts requests to POST session/refresh authentication and GET accounts,
positions, transactions and activity. It contains no trade, order, withdrawal or
account-preference mutation paths. Failed logins and rate limits are not retried.

OAuth account headers explicitly select the requested enabled SPREADBET account.
CFD and physical share-dealing accounts are excluded. When multiple enabled
spread-betting accounts exist, an explicit account ID is required. Live and demo
origins are fixed; redirects are disabled. Read traffic is serialized at least
2.2 seconds apart, within IG's documented 30 account reads/minute limit.

History requests use disjoint 31-day UTC windows with a fixed end. Transactions
use v2 page metadata, while detailed activity uses v3 next-page URLs. Continuation
URLs cannot change hosts or endpoints or escape the requested date bounds.
Incomplete pagination prevents saving a new snapshot. Counts describe downloaded
raw rows, not reconciled trades. A successful download alone does not prove that
IG supplied the account's entire historical lifecycle.

For the user's accounts opened around September/October 2025, the default history
floor is 2025-09-01. It remains configurable in the connection form.

Share dealing is excluded by IG's public API. Import preparation requires its
full Account/Ledger Summary CSV from MyIG > Live accounts > History and the latest
monthly statement for independent holdings/cash verification. A parser must be
built against the supplied export headers; don't invent mappings or mix the
share-dealing and spread-betting accounts. Actual files, credentials, balances
and personal records must never be committed to Git.

Official references:
- https://labs.ig.com/rest-trading-api-guide.html
- https://labs.ig.com/reference/session.html
- https://labs.ig.com/reference/accounts.html
- https://labs.ig.com/reference/history-transactions.html
- https://labs.ig.com/reference/history-activity.html
- https://labs.ig.com/reference/positions.html
- https://labs.ig.com/faq.html
- https://www.ig.com/uk/help-and-support/articles/687076-what-statements-will-i-receive
