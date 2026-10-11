# Consolidated plan trade view

Tracked in #100; implementation in PR #97, test first.

Trade & Manage and Review provide **View plan trade**. A plan is the review unit: any number of linked entry and exit fills may come from different broker-matched trade records. Group those allocations by the plan row, preserving its defined order. Show allocated quantity, date range, weighted execution price, entry position value, realised exit profit and whole-plan position totals. Expand each row for its source fills, broker FX and original trade links.

Use the existing verified planning ledger and account settlement calculations. Currency selection follows display, account and this asset currencies. Do not calculate a second P/L basis or silently pair different trades. Preserve manual linking, source quantities, broker matching and stored transaction FX. Flag provisional executions, missing FX, stale source evidence and excess exits. Keep historical source corrections auditable.

This view does not repair broker repartitioning automatically. Stable original-fill identity and deliberate reconciliation of changed partitions remain a separate follow-up under #94. Sharing a fill across plans remains deferred.
