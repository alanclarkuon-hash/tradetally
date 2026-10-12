# Quote and historical coverage release

Related issues: #33, #34, #35, #51, #52, #54, #56, #60, #63.

Current quotes use connected broker capabilities before supported provider fallbacks, share request lanes, and preserve instrument identity and quote currency. Atomic persistence rejects older timestamps; missing movement remains unavailable. Trade timestamps and observed broker position prices are distinct. Only provider-confirmed extended sessions receive icons.

Daily closes are finalized independently of live quotes. Reconstruction detects actual session gaps and atomically merges dated history while retaining existing dates, native currency and split evidence. Conflicting or unavailable metadata retains previous coverage. Confirmed derived history is retained when a retry cannot verify values; its coverage note remains visible. Statement values keep precedence.

Broker syncs capture the current broker portfolio value without joining the historical maintenance queue. They commit their results and then enqueue durable history; the worker performs historical reconstruction and missing-price downloads independently. Statement imports likewise queue durable history. The dedicated worker checkpoints its cursor and renews its lease. An active job remains visible ahead of a queued follow-up. UI polling does not download prices.

Current-range heatmap basis uses native replayed lots and must reconcile with current broker quantities. Opening basis uses the strictly preceding completed exchange session, or purchase price for acquisitions inside the range. Missing open-session prices remain unavailable. Incomplete Holdings baskets suppress all performance metrics and the comparison series, including late acquisitions without cashflow-adjusted comparison evidence.

Validation: synthetic regression suites, rolled-back PostgreSQL quote ordering/finalization checks, actual TEST migrations and browser checks. Account records and plan allocations are verified unchanged by aggregate fingerprints.

Limits: retired instruments, unsupported venues, undocumented broker candle conventions and provider history permissions may leave visible gaps. These are not filled with invented prices. Trading 212 position quotes supply observation time rather than verified last-trade time. Options and futures need contract prices and cannot use underlying closes as equivalent values. Production requires a separate release authorization.
