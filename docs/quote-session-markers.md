# Heatmap quote sessions

The Portfolio heatmap shows a sunrise for a quote identified as pre-market and a crescent for a quote identified as post-market or overnight. Hovering the icon identifies the session. The yellow `d` is independent: it appears when the saved quote timestamp is more than fifteen minutes old, even when the market is closed. A delayed session quote can show both markers. Unknown timestamps do not create a delay marker.

Session describes the saved price, not the current wall-clock session. The shared quote writer persists `quote_session` atomically with its accepted price and timestamp; rejected older quotes cannot change the session. Identical source/price/timestamp rows can gain previously missing session metadata. A new unknown-session quote clears the old session label. Historical heatmaps and broker position valuations without session evidence remain unlabelled.

Yahoo's current-quote adapter requests intraday data with `includePrePost`. It keeps `regularMarketPrice` for regular trading, and selects a later positive extended-hours candle only when that candle falls within Yahoo's explicit dated pre/post boundaries. Null candles, future timestamps and undated session guesses are rejected. This is an intraday candle observation, not a guaranteed tick feed. If Yahoo returns no usable extended data, the regular price remains available.

Other adapters may supply `session` as `regular`, `pre`, `post`, `overnight`, or `continuous` when supported by source evidence. Current eToro, Trading 212 and Finnhub responses do not provide an explicit session mapping in our integration and remain unknown. Schwab's separate extended block is not yet mapped to pre/post/overnight; trading support does not prove API feed session coverage. Crypto is continuous and has no stock-session icon. No overnight session is inferred from download time.

The provider priority, quote polling cycle and daily history policy are unchanged. Portfolio refresh loads newly saved prices/session metadata; the open page's thirty-second clock updates delay markers independently.
