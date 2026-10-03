# Portfolio dashboard prototype

Branch: `codex/portfolio-dashboard-prototype`. Review at the test server's
`/dashboard/portfolio` route. Production deployment requires explicit approval.

The view combines selected account holdings, verified fiat cash and stablecoins.
Stablecoins are excluded from the industry heatmap and counted once in totals.
Spread-bet notional exposure is not treated as an owned investment asset.
GBP and USD display options use current conversion rates.

All time shows unrealised holding P&L against recorded acquisition cost. Other
ranges calculate price change on the lots still held today, using explicit USD
prices or historical candles with a declared currency and dated conversion.
UK minor units are normalized by the existing chart provider. Missing prices,
unmatched lot quantities, derivatives and incomplete histories remain unavailable.
P&L excludes closed trades, funding and income; its display conversion uses the
current FX rate. Fund holdings are grouped separately without industry look-through.

Latest total value always remains current. Full historical portfolio value change
is currently unavailable: existing investment snapshots omit cash and do not
provide a complete per-account history. It must not be inferred from unrealised
holding P&L. The top card states this limitation explicitly.

Industry labels come from existing enrichment/analysis caches and the existing
exact-symbol market profile provider. Unclassified assets remain visible.
The local portfolio account picker supports multiple selections, initially
following the global single-account filter, without changing other page filters.

Validation covers stablecoin double-counting, account isolation, unavailable cash,
dated price conversion, period cost basis and treemap area/overlap behavior.
No private statements, identifiers, credentials or screenshots belong in this branch.

Crypto remains a single asset class with category subgroups. CoinGecko category
labels are cached for 24 hours in the test data volume. One display theme is
chosen per coin (AI, RWA, DeFi, Meme, L2, L1, then other descriptive labels),
while all provider labels remain available in holding details. This is a display
convention, not an exclusive classification. Missing categories remain unknown.
Provider failures preserve cached labels; rate limiting pauses further requests.
# Trading 212 current instrument names

Trading 212's instrument `ticker` is a permanent API identifier. Current
holdings use `shortName` and `name` from `/equity/metadata/instruments`, refreshed
on each successful sync. For US and London listings the short ticker supplies
the market-data symbol; London retains `.L`. Unsupported exchanges and missing
or invalid short tickers retain the existing symbol rather than guessing.

Catalogue entries must match the exact broker ticker, with an ISIN mismatch
rejected. Execution history, fill identities, quantities, costs and cash records
are unchanged. Portfolio and dashboard views use the current symbol while
retaining the original symbol for matching historical lots and dividends. The
Assets page can find the original Trading 212 stock trades under the current
symbol. The original broker identifier remains stored in the snapshot.

For existing test snapshots, `backend/scripts/refresh-trading212-labels.js`
refreshes instrument labels only. It defaults to preview; `--apply` writes
metadata. It refuses any environment other than the isolated test database,
preserves valuation timestamps and refuses a concurrent snapshot change.
# Portfolio value chart

The portfolio tab records observed account values in `portfolio_value_history`,
separately from the older holdings-only `portfolio_snapshots`. Each daily record
contains investments, fiat cash and stablecoins in USD, plus the GBP conversion
rate observed when recorded. It never backfills a portfolio total using current
holdings or adds funding flows to an already complete balance.

Opening or refreshing the portfolio captures today's selected accounts. The
existing portfolio snapshot scheduler also captures total values daily when
background jobs are enabled. Test keeps background jobs disabled, so values
are recorded when the page is used. An offline PC cannot record observations.
Historical observations were not recorded before this feature. Saved native
ledgers, execution histories and public closing prices can now reconstruct
covered days. Missing selected-account days and missing dated GBP conversion
rates produce gaps, not zero balances.

Cash deposits, withdrawals and transfers crossing the selected account boundary
are shown as funding markers using Account & Cashflow history. Matched transfers
inside the selection are removed even when their two dates differ. Dated FX
comes from saved FX records; missing rates retain the original-currency amount
in the tooltip and accessible table. Coin transfers are not cash funding markers.
Valuation recording dates do not imply every underlying quote is from that day.

## Historical reconstruction (test prototype)

`backend/scripts/reconstruct-portfolio-history.js` is restricted to the test
environment. It previews by default; `--apply` saves derived history, and
`--prices` permits public Yahoo, Kraken market-price and Frankfurter FX reads.
It never calls authenticated broker APIs, starts syncs, changes broker settings,
or imports financial transactions. Back up the test database before applying.

Derived account days are stored in `portfolio_reconstructed_values`, with
explicit gaps and reasons. Crypto quantities replay native ledger movements
and fees; overlapping Earn allocation summaries are not added. Share fills
replay dated splits, and later split adjustments are reversed in Yahoo closes.
Prices in minor units are normalized, and historical currency conversion uses
dated rates. Corporate-action quantity mismatches, missing closes and missing
derivative valuations invalidate the complete account-day total.

`backend/scripts/capture-etoro-statement-history.js` independently verifies a
privately supplied statement's identity and cash activity before recording its
dated USD equity totals in `portfolio_statement_values`. Opening equity belongs
to the preceding day's end, not the statement's first day. These observations
take priority over derived values; live recorded snapshots take priority over
both. Original statements and source financial records are never Git artifacts.

The chart can show individual selected-account histories while the combined
line has gaps. A combined point requires every active selected account to have
a complete value on that date. It never labels a changing subset of accounts
as the total portfolio. Coverage and missing-information reasons are available
below the chart. Reconstruction is separate from automatic daily recording;
new statement equity capture currently uses the test-only script.
