# Portfolio history from manual statements

The existing eToro and IG preview/apply workflows now save confirmed dated
portfolio values together with their cash and trade imports. Upserts use the
account and valuation date, so repeat uploads cannot create duplicate chart
points. Confirmed statement values take priority over reconstructed or
carried-forward values; dates outside an upload remain intact.

## eToro

Use the eToro quick pick on Import and upload the original XLSX statement.
The saved cash history must overlap and reconcile with the uploaded activity.
The upload saves opening/closing equity totals and dated holdings snapshots,
subtracting reconciled cash so it is counted only once. Dated GBP conversion
uses stored rates or the existing FX provider. Missing conversion stops the
transaction rather than committing an incomplete GBP chart value.

Trades and current holdings still come from Broker Sync. A statement upload
does not import trade executions or resolve missing execution metadata.

## IG

Use the IG statement form on Broker Sync. The usual monthly reports save a
dated share-dealing value (cash plus the confirmed holdings market values) or
spread-betting value (funds plus signed running P&L, never notional exposure).

Spread-betting accounts also accept multiple optional daily statement PDFs.
For dates already covered by saved transactions and the last confirmation,
daily PDFs can be uploaded alone. For newer dates, include the updated full
transaction reports and monthly PDFs. Files must match the selected account,
reconcile equity and cash, and lie inside verified coverage. Duplicate daily
files are collapsed; disagreeing values for the same day stop the preview.
The upload limit is 20 files, 5 MB per file and 30 MB in total.

## Commit and chart update

Preview performs checks; apply requires the existing private backup first.
Confirmed values are written in the same database transaction as the import.
After commit, selected-account history is reconstructed with existing broker
records and public historical prices. The portfolio reads confirmed statement
points automatically; later statements supersede carry-forward estimates.
Refresh an already open portfolio page to load the update.

Reconstruction failure produces a sanitized warning and retains committed
statement values. Missing prices and dates retain the previously agreed
estimate behaviour. No broker sync is started by a statement upload.

Private workbooks, PDFs and financial records are not repository fixtures.
