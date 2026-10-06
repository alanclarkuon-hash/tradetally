# Shared broker-first price caches

Portfolio heatmap boundaries use the same persistent daily cache as Holdings. Missing history is downloaded in the background through registered broker capabilities, configured providers and Yahoo (stocks) or CoinGecko (crypto). Completed daily prices are normalized to USD with dated FX; native units such as GBp are divided explicitly. Unknown historical units are excluded until refreshed, rather than silently treated as USD. Crypto cache identities retain their `crypto:` prefix.

A baseline must be present for the preceding expected trading session, using the exchange calendar. Missing prices on an open session do not permit a fallback to an older session. Crypto requires the preceding calendar day. Historical heatmaps prefer the shared completed cache and retain split-aware reconstruction as dated fallback evidence.

Normal downloads reuse verified historical data. Only an explicit administrative refresh can replace finalized provider closes with verified finalized broker candles. Live quotes remain provisional and cannot replace finalized daily candles. Unsupported broker identities, periods or split-adjustment evidence retain provider fallbacks and are reported as gaps. Trading 212's position quote endpoint is not a historical-candle endpoint; IG remains statement-only and IBKR Flex is not a live historical market-data feed.

## Refresh existing stored prices

Back up and verify the target database first. Run `node scripts/refresh-price-caches.js` inside the backend runtime for a single-user installation; multi-user installations must explicitly select `--user=<id>`. This queues an existing historical-price worker job in `broker_refresh` mode, without initiating a broker account sync or importing financial transactions.

The persisted job inventories saved quotes, historical rows and reconstruction price series. It refreshes saved quotes first, then checks broker history for all stored ranges, preserving already verified immutable broker rows. Accepted broker closes can replace finalized provider rows and update corresponding reconstruction price dates while preserving native units and split metadata. Remaining actual gaps use the regular shared provider fallback. Unknown units and unavailable providers remain gaps. It renews its lease, persists its cursor and resumes after restart; quote failures do not prevent history refresh.

The Historical prices panel shows the quote phase and historical phase separately, then reports coverage gaps and quote failures. Rate limits and cooldowns use the same in-process broker/provider lanes as normal monitoring and backfill. Private job payloads and backups stay in the database/private storage. Release to production requires separate authorization and its own verified backup.
