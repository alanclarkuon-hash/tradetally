# Historical price backfill

Successful manual and scheduled broker syncs enqueue `historical_price_backfill` after the import is committed. Failed syncs, unreconciled imports and unavailable IBKR reports do not enqueue it. Confirmed eToro and IG statement uploads also enqueue history work. Price-provider failure never changes a successful broker import into a failed sync or retries private broker requests.

The database job queue stores the plan, cursor, progress and unresolved date ranges. Pending requests for one user are deduplicated with a transaction advisory lock; a running job can have one follow-up for newer imports. Each finished asset checkpoints progress. A heartbeat renews the worker lease during long downloads; existing stuck-job recovery resumes abandoned work. Downloads are serialized by asset cache key, across overlapping date ranges and users, and re-read persisted prices after acquiring the lane.

The plan includes open and closed imported trades, option/future underlying symbols where recorded, investment lots, native Kraken/OKX ledger assets including stablecoins and Earn wallets, and the configured comparison benchmark. Closed trades include a 30-day analysis window around entry/exit. Only finalized past days are warmed. Missing option/future underlying IDs and unavailable instrument histories remain limitations; underlying history cannot substitute for an option contract's own historical valuation.

History jobs have their own durable worker lane. They cannot block sequential email jobs or consume the short-lived parallel enrichment slots. The background-worker lifecycle starts and stops that lane; daily portfolio maintenance queues the same work.

## Sources and units

`brokerHistoryProviders.js` is the broker capability registry. New adapters accept an explicit instrument type and dated range and return validated daily candles. Registering an adapter does not require changes to the worker, sync orchestrator or UI. Source coverage is recalculated after each adapter; only remaining dates reach fallbacks.

- Kraken: public AssetPairs resolves an exact USD pair; daily OHLC is limited to the latest 720 bars. Uncommitted candles are discarded. Existing reconstruction support for the official Kraken archive remains available for older retired markets.
- OKX: public spot instrument metadata, bounded UTC daily history pagination and confirmed candles. USDT market prices require a matching dated USDT/USD broker index; missing conversion coverage falls through, never assumes a 1:1 peg. Regional origins are taken from the connection configuration.
- eToro: saved instrument IDs, bounded daily Data API cursor pagination through the existing authenticated read-only lane. Only explicitly USD-quoted crypto candles are accepted. Stock candle currency and split-adjustment semantics are not documented sufficiently to mix them with adjusted equity candles, so equity history currently falls through to market-data providers. Missing API permission or unsupported Data API endpoints also fall through.
- Equities: configured Alpha Vantage / Finnhub or FMP routing, then Yahoo for missing dates. Crypto never uses stock-provider endpoints: supported broker adapters precede CoinGecko, whose shared persistent budget/cooldown remains in force.

Daily comparison candles and portfolio reconstruction have different price conventions. Reconstruction requires quote currency, minor-unit normalization and historical split reversal. Its split-aware equity store is retained; the background reconstruction stage obtains that metadata and dated FX, preserves statement NAV precedence, and rebuilds earlier gaps. Crypto reconstruction reads the shared typed USD candle store while retaining saved native/archived valuation evidence.

## Persistence and progress

Finalized rows in `historical_prices` never expire and cannot be overwritten by subsequent providers. Live quotes carry `is_final=false`; after that date ends they are excluded from historical coverage until finalized daily candles replace them. Existing finalized data is preserved. Intraday quotes and downloaded current-day candles are provisional, not guaranteed daily closes.

The read-only authenticated `/broker-sync/history/status` endpoint returns only the caller's progress and gap details, not credentials, raw statements or task internals. Broker Sync, Holdings and Portfolio share the same progress panel. `Update history` queues only historical market-data/derived chart work and does not start a broker account sync. Polling pauses while the page is hidden. Unreturned stock dates can include exchange holidays; the UI labels them as dates to review rather than falsely claiming every absent weekday is a provider failure.

Implementation is tracked in GitHub issue #34 and PR #30. Production requires separate release authorization.
