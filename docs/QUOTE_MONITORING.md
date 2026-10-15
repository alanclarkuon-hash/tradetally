# Current quote monitoring

The monitor selects open trades, broker snapshot positions, investment holdings, watchlists and active alerts. Identities distinguish crypto from equities. Sorted batches contain at most PRICE_MONITOR_MAX_SYMBOLS (default 25) and are attempted every 30 seconds. A slow batch skips overlapping ticks; it never starts a second batch concurrently.

A full rotation means every identity in a stable selected set has been attempted, including failures, unsupported identities and provider-capacity skips. It does not mean every provider returned a fresh quote. Timing includes the waits between batches. When the selected set changes, the in-progress measurement restarts. Measurements reset on app restart. Completion logs contain aggregate counts and elapsed seconds only.

The authenticated Pro endpoint GET /api/investments/portfolio/quotes reads only the saved quote cache and display FX rates. It returns aggregate monitor status (current progress, last full rotation, last batch and skipped ticks). It accepts at most 250 quote keys. It does not fetch provider quotes, download history, create chart captures, or start broker syncs.

Portfolio polls this endpoint every 30 seconds while visible, with one request at a time and a 15-second timeout. Requests are cancelled on filter changes/unmount; stale replies are ignored. Returning to the tab refreshes quotes. Quotes update current holdings and totals using the existing quantity and period basis; the dated historical heatmap, cash, chart history and broker CFD equity remain unchanged. New transactions and cash activity still require the normal broker sync/full dashboard refresh.

Broker quotes retain priority when their source time is within 15 minutes. A stale or undated result allows later connected brokers and supported providers to be tried. The newest dated result wins if all sources are old; unknown timestamps never displace dated evidence. No fetch time is substituted for an old trade time. Closed sessions and halted listings may legitimately retain an old quote and delayed badge. All original provider pacing, cooldowns and currency conversion rules still apply.
