# Heatmap period returns

Dated heatmap returns use the selected card currency for both P&L and percentage. The opening close is valued with that session's saved USD-to-display FX; units acquired during the period use their acquisition date instead. The ending value uses the dashboard's ending/current display FX snapshot. Percentage is (ending value - converted opening basis) / converted opening basis.

Historical replay retains each account's remaining units, execution costs, corporate actions and broker CFD collateral equity. Converted opening bases are summed only after account-specific replay; incomplete historical FX leaves the return unavailable. USD market caches, source fills, broker costs and financial records are unchanged.

The heatmap's saved currency preference drives its server calculation. Automatic market-quote and supported broker-position refreshes reuse the already converted opening basis. Historical heatmaps remain fixed at the selected end date. Lifetime unrealized returns retain the existing broker cost-basis calculation; this change concerns dated period returns.
