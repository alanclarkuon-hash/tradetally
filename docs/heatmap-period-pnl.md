# Heatmap period P&L

For every dated range, a lot owned before the first included date uses the completed daily close strictly before that date as its opening basis. A changing candle on the first included date is never the baseline. Equity lookups use the preceding available close across weekends and holidays, with a seven-day limit to avoid treating long outages as ordinary closures. Crypto trades continuously and requires the preceding calendar day's daily close.

Lots acquired within the range retain their recorded execution cost. All Time keeps gain/loss since acquisition. The percentage is `(ending holding value - opening basis) / opening basis * 100`, weighted by the quantities still owned at the range end. Sold holdings are excluded from the heatmap. Missing baseline prices or unreconciled lot quantities remain unavailable rather than producing invented gains.

Current ranges end at the latest saved holding quote. Historical ranges use dated historical holdings and closing prices. Historical split adjustments include splits on the first included day because the baseline is now the preceding close. Statement-ledger reconciliation and existing split/lot coverage requirements still apply.

The baseline change affects heatmap holding P&L, not the Portfolio Value chart or account balances.
