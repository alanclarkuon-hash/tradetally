# Lightweight broker position valuations

Issue #197 builds on #195. Current market quotes and leveraged position valuations are distinct. Market price times units is never used to refresh imported CFD equity.

## Supported capabilities

| Connection | Current capability |
| --- | --- |
| eToro read API | Existing imported CFDs, including CFD exposure to foreign assets or crypto, using verified position IDs and broker USD invested amount + reported unrealized P&L |
| Trading 212 Invest | Existing stock/ETF quote refresh; no CFD account import/valuation adapter |
| OKX / Kraken | Existing spot quote refresh; leveraged contracts are not imported/reconciled by these adapters |
| IBKR Flex / IG statements | Dated statement/snapshot values; no live leveraged valuation endpoint configured |

The registry is broker-specific and explicit. Unsupported contracts retain saved values and a status; support is not inferred from an underlying ticker or an unrelated account's quote.

## Processing and identity

When price monitoring starts, a separate 30-second timer schedules valuation reads. Browser quote reads can also warm the same cache. One in-flight refresh is allowed per user/connection/account, successes are reused for 30 seconds, failures back off for 60 seconds, and existing broker queues and cooldowns remain in force. Requests are read-only. They fetch account identity and current position P&L only, without trade history, fills, cash imports, sync records or history jobs.

The eToro adapter matches the exact imported position set, ID, instrument, account, direction, settlement product, leverage, units, opening rate/FX, and allocated capital. Copied positions are deduplicated with conflict checks. Missing, new, closed, resized or inconsistent positions are marked as requiring a sync rather than changing holdings. A concurrent sync invalidates the result before it can be applied. The cache is in memory, keyed by owner/connection/account and snapshot generation; no broker or financial tables are updated.

USD equity follows the documented eToro formula: allocated `amount` plus `unrealizedPnL.pnL`. Leverage, fees, financing, taxes and FX are not applied again. Zero/negative equity is allowed. Broker P&L timestamps remain truthful; when omitted, the response observation time is explicitly labelled. Missing/malformed valuation evidence is never replaced by a stock quote.

Current Portfolio reads overlay verified values on the saved position set. Automatic browser updates require matching account set, quantity and capital, use the existing display-FX snapshot and period P&L basis, and preserve cash and historical heatmaps. Mixed-account values include only the selected user's selected accounts, with freshness reflecting the oldest component. The detail line says 'Broker position valuation', with pending, unavailable, unsupported or sync-required status where appropriate.

## Sources

- https://api-portal.etoro.com/core/guides/calculate-equity.md
- https://api-portal.etoro.com/core/guides/calculate-total-invested.md
- https://api-portal.etoro.com/llms.txt
