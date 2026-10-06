# Market price cache coordination

Current quotes and historical candles have separate write policies.

- `marketQuoteCache.save` is the only writer to `price_monitoring`. The scheduled monitor, trade hydration, watchlists and alerts use it. Prices are normalized to USD and crypto keys use `crypto:SYMBOL`.
- Current quote upserts compare provider timestamps atomically in PostgreSQL. An older fallback cannot replace a newer broker quote, including concurrent page requests. At equal timestamps, broker quotes take precedence. Missing daily movement fields stay unavailable.
- Provider clients cache their raw responses for request reuse; fetching a raw quote during enrichment no longer writes a daily candle. Metadata enrichment remains separate from portfolio price persistence.
- Accepted current quotes can update today's provisional daily row, using the quote's own UTC date and timestamp. Yesterday's close cannot become today's candle. Provisional writes cannot replace finalized candles or newer provisional values.
- Historical download jobs fill missing daily coverage through `insertCandles`. Finalized daily rows are immutable. A complete historical close may finalize a previous provisional row; it never rewrites a finalized close.
- Successful reconciled broker syncs enqueue the existing history backfill job. That job reuses cached coverage and shared rate-limited broker history adapters. It does not compete with current quote rows.
- Concurrent Trading 212 quote requests share one positions response. Public broker history and quote reads use the shared broker request lanes. The monitor retains its startup run, 30-second interval and 25-symbol rotation; unsupported symbols do not stop later supported holdings in the batch.

These are periodically refreshed quotes, subject to market opening hours, provider timestamps and rate limits. CoinGecko fallback retains its existing 15-minute response cache. Original quote timestamps are never replaced by the time a page happens to read them.

This change depends on the test quote routing and timezone migrations, and the historical backfill/finalized-candle work. Release these dependencies together or in order; do not deploy the cumulative test image directly to production.
