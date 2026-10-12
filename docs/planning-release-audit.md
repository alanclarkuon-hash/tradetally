# Planning release audit — 12 October 2026

Tracked in #23 and PR #123. This audit authorizes TEST verification only. Production release requires the owner's explicit approval.

## Candidate and scope

Runtime commit: b17c5faa. The full Dockerfile build, including the production dependency deployment and frontend build, succeeded. TEST now runs the complete candidate image, rather than an overlay of individual fixes.

Candidate tag: tradetally-planning-candidate:b17c5faa.
Image: sha256:02947be208f690f0d392cdf10a992a1f0404be2635f78f7272a116403560d7da.

The release covers preparation/finalisation, Watching, original broker entry/exit fill links, partial/shared allocations, remaining-exit rechecks, editable stop history, risk evidence and account-native plan/trade reporting. Broker FX, cashflow attribution, ticker identity and import classification fixes are dependencies of correct linking and results. The previous basic review/completion and option fields remain in the implementation; additional review, options and tactic-library development remain deferred. No new deferred enhancements were added by this audit.

The software release does not itself transfer existing TEST plans/allocations or repair production financial records. Whether to carry TEST plans and links into production is an outstanding owner decision. Any transfer needs a separate account/source-fill mapping and conservation check, preserving production broker records and preferences.

## Migration rehearsal

A fresh read-only production custom-format database dump was retained in external private production backup storage. It was restored into a separate rehearsal database in the TEST PostgreSQL container. No server, scheduler, sync or email worker was started against that copy.

All eleven pending migrations applied successfully: 285_trade_planning, 286_planning_lifecycle, 287_planning_review_drafts, 288_manual_exit_matching, 289_planning_finalised, 290_account_realised_reporting, 291_broker_instrument_catalogues, 292_planning_journal_evidence, 293_planning_cashflows, 294_planning_exit_sizing and 295_broker_capacity_evidence. The pre-existing 285_ig_ingestion_retry_context migration remained recorded and was skipped by filename.

Private fingerprints of every original table and column matched after migration, excluding the migrations ledger and rebuildable analytics cache. The new schema is additive for the existing records; migration 290 clears the analytics cache. A repeat migration run using the complete candidate applied zero migrations. The restored rehearsal database was removed after verification; the private dump remains outside Git.

## Validation

- Green runtime CI: https://github.com/alanclarkuon-hash/tradetally/actions/runs/38271678006.
- All seven TEST PostgreSQL/API suites passed against the full candidate: lifecycle, multi-account, partial commitments, journal, cashflows, shared exits and entry checks.
- Authenticated browser walkthrough: Draft finalisation locks preparation; Watching focuses Trade & Manage; two original buy fills link to one row; a partial exit leaves five units and the final exit leaves zero. Plan and combined trade detail show the same account-native net profit, percentage gain and four executions.
- The shared account reporting calculation used by ordinary trades/dashboard matched the plan's synthetic result, including supplied transaction FX and fees.
- Unknown risk remains unavailable rather than zero; manual IG/IBKR verification remains required as described in planning-entry-checks.md.
- Synthetic fixtures and the agent tab were removed. TEST is healthy; production's original application image remains unchanged.

The walkthrough used a synthetic symbol with no market-data coverage, so it verifies execution links and results rather than live market chart markers. Existing automated chart/identity checks remain part of CI.

## Approved-release procedure and rollback

After explicit release approval, retain a fresh private database backup plus retained uploads, external configuration and the current production image. Pause production broker schedules/background writers for the acceptance window. Deploy the pinned candidate and run the filename-based migrations with the existing database retained; do not initialize a new production database. Preserve production credentials and preferences.

Accept the release after verifying login, existing trades/dashboard/portfolio P&L, a new plan's preparation/Watching flow, fill finder scope, entry/partial/final-exit links and combined trade navigation. Confirm account/native/display currencies and manual/unknown risk labels. Resume jobs only after acceptance and check their next scheduled runs.

The retained production image at audit time is sha256:64f215a47cefe17a6d037c15aa7c31d038f1745eae832035f9e7e04b21571bc1. Restore that image if application acceptance fails; the additive schema need not be destructively downgraded. If database restoration is required, stop writers and retain post-cutover data before restoring the pre-cutover backup: restoring it discards later writes. Do not drop planning tables as a rollback shortcut.

No production deployment, broker sync, data promotion or financial repair was performed in this audit.
