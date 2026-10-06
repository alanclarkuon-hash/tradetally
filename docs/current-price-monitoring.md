# Current price monitoring

The service runs at startup and checks every 30 seconds. It rotates through up
to 25 instrument identities per cycle (`PRICE_MONITOR_MAX_SYMBOLS` overrides the
batch size). A running cycle is never overlapped. Open trades, investment
holdings, saved broker positions, watchlists and active alerts provide symbols.
Portfolio page refreshes share the same quote router and request deduplication.

Stocks/ETFs use supported active broker connections, then Finnhub, then Schwab,
then Yahoo Finance. Crypto uses supported brokers, then CoinGecko only. The
configured general market-data provider does not change this explicit current
quote order. Existing provider caches and CoinGecko's shared budget are reused.

Current broker capabilities: eToro (stock/ETF/crypto), Trading 212 (held stocks/ETFs), Kraken (crypto USD pairs),
OKX (spot crypto in the configured region). Register future quote capabilities
in `brokerQuoteProviders.adapters`. IBKR Flex
and manual IG statements remain broker valuation sources; they are not polled
as general quote APIs.

eToro uses its existing authenticated read queue, with at least 1.1 seconds
between sends. This is conservative against both its default 60/minute quota
and its documented shared 120/minute market-data quota. Quotes yield to queued
sync/history work. Exhausted quota headers and Retry-After trigger cooldowns.
Trading 212 reuses one positions response for 30 seconds across symbols, with
at least 5 seconds between requests on the same lane used by broker sync. Its
positions endpoint is a held-assets capability, not a general market quote API.
Kraken and OKX public data share a 2.5-second lane with sync valuation reads;
quotes yield to active work. Pending historical-data adapters must use this
same lane when released. Public calls send no account credentials. Private
Kraken/OKX account requests have separate documented budgets and existing queues.

Rate limits are per deployed process. Running production and test together
against the same credentials/IP also consumes the upstream budget; these
conservative limits leave headroom but cannot account for unrelated external
clients. Provider 429/error-code cooldowns apply to the whole lane.

Quotes are validated for identity, positive finite prices and USD units. eToro
uses its bid and explicit USD conversion; Kraken uses last trade; OKX uses last
trade with a contemporaneous USDT/USD index when needed. Yahoo foreign quotes
are converted from declared currency, including pence. The cache preserves
broker timestamps where provided and separates crypto from stock identities.
These are valuation quotes, not guaranteed executable prices.

References checked 6 October 2026:

- [eToro rates and shared quota](https://api-portal.etoro.com/api-reference/market-data/get-instrument-market-rates)
- [Kraken public limits](https://support.kraken.com/articles/206548367-what-are-the-api-rate-limits-)
- [Kraken ticker](https://docs.kraken.com/api-reference/market-data/get-ticker-information)
- [Trading 212 positions](https://docs.trading212.com/api/positions)
- [OKX ticker and public market limits](https://app.okx.com/docs-v5/en/#order-book-trading-market-data-get-ticker)
