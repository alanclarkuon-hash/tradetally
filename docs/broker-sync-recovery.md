# Interrupted broker sync recovery

Issue #99: startup recovers unfinished started, fetching, parsing and importing logs before accepting requests, independently of scheduler/background-job settings. Read-only standby startup skips recovery. Each broker connection has a PostgreSQL session advisory lock held for the complete orchestrated sync; another application instance skips locked live work. PostgreSQL releases the lock if a worker process exits. Manual retry also recovers abandoned logs under this lock before creating its new run.

Recovered logs become failed with an explicit interrupted outcome, retryable error code, completion time and bounded duration. Existing counters, progress and committed broker records are retained. Connection credentials/status, failure counters and last successful sync time are unchanged, so interruption does not require reconnection. A newer run protects its connection summary from older recovery. Retry uses existing broker reconciliation/deduplication; recovery never deletes or rewrites trades.

Trading 212 updates bounded section/page metadata for trade history, cash transactions and dividends, followed by cash reconciliation and portfolio maintenance. Sync History shows this progress and labels recovered jobs Interrupted with retry guidance. Broker response contents, credentials and pagination cursors are excluded.

Verification uses unit/UI regressions and an isolated PostgreSQL schema: kill a worker holding the lock after synthetic committed data, recover all four phases, preserve a live worker and newer successful run, then exercise orchestrator retry with an idempotent synthetic adapter. No live broker requests or financial fixtures are required for the interruption test.
