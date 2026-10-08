# Planning design mockup

Tracked design artifact for [issue #23](https://github.com/alanclarkuon-hash/tradetally/issues/23), reviewed alongside implementation PR #89.

Open planning-review.html directly in a browser. It is self-contained and demonstrates Plan, Trade & Manage, Review and Close with share and single-leg options examples. It has no application, database or broker connection. Inputs and linked example fills are held in memory and reset on reload.

All accounts, prices, quantities and fills are synthetic. The dated indicative FX rate links to its public source. Calculations illustrate the design; fee handling, real execution allocation, risk checks and broker reconciliation remain implementation work.

Keep private requirements, user strategies, statements, credentials, screenshots and financial records outside the repository, including ignored files. Only synthetic source and generic notes belong here.

Treat this file as the versioned design source. Changes to a local review copy should be reviewed for private data, copied here and committed so the source remains recoverable. Local review copies are not automatically synchronized.

Latest review additions: current stop/protection, account/combined capacity scenarios and commitments, partial/batch source-fill allocation with fees, baseline/revision history, editable option contract and contract-delta inputs, market-context comparison on Review, and net-credit same-or-fewer rolls with fee/specification/risk comparisons. Example risk ceilings and balances are synthetic scenario data, not application defaults. Financial calculations remain a walkthrough requiring real broker and historical FX integration.

Risk display now uses a top bar on Trade & Manage: current combined risk, all-remaining-entry projection, a marked limit and current/projected breach or missing-coverage feedback. The previous Entry capacity scenario form is removed. Projection is visible before ticking executions and does not reserve exposure. All risk amounts are synthetic.

SL invalidation is now edited inline with a required reason and dated old/new management event. The separate protection form is removed. Mockup events are in-memory; database-backed persistence is an application requirement, not provided by this HTML file.
