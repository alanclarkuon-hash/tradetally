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
