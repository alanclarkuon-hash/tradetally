# IG email statement ingestion

Issue #1. Implement and verify on test before a separately approved production release.

Outlook forwards IG statement emails to Gmail. A user-owned Apps Script copies only permitted PDF attachments into the private **TradeTally ingester** Drive folder. Drive desktop makes the folder available to the local server. The server checks the mounted folder every minute; the cloud exporter checks Gmail every 15 minutes. The server can catch up after downtime.

## Gmail setup

Create an Apps Script project in the Google account receiving the emails. Copy `scripts/ig-email-exporter.gs` into `Code.gs` and `scripts/ig-email-exporter.appsscript.json` into the project's `appsscript.json` manifest. Enable the manifest in Project Settings. Set Script Properties `IG_FOLDER_ID` to the ingestion folder ID and `IG_FORWARDER` to the Outlook sender address. Keep these private configuration values out of Git. Run `collectIgStatements` once, then `installIgTrigger`.

Authorize Gmail **modify** access, Drive access and trigger creation. Gmail modify is required to move messages to Trash; Google grants broader mailbox capabilities than the collector uses. DriveApp requires the broad Drive scope; the script itself writes only the configured private folder. Review the code and permission prompt before approving. Revoke access in Google Account → Security → third-party connections; remove the project trigger to stop collection.

Set Script Property `IG_TRASH_PROCESSED=true` to clean up Gmail copies. The collector moves a matching message to Trash only after all its PDFs and metadata appear in the private `Processed` archive following a committed import or duplicate acknowledgement. Merely exporting to Drive is insufficient. Review/conflict files stay pending; imported valuations with an activity-reconciliation warning are acknowledged because their PDF evidence is preserved. Outlook originals are untouched. The script never permanently deletes messages, sends mail or changes read status. Existing timestamp receipts are upgraded without exporting the same PDF again. Changing from the old read-only scope requires the owner to approve Google's new consent prompt.

The exporter uses message receipts and PDF hashes. It writes a PDF and bounded JSON metadata containing its checksum and reporting date. PDFs with the same filename from different accounts cannot overwrite each other. Original filenames and statement accounts are not public test fixtures.

## TradeTally setup

Mount only the dedicated ingestion folder into the app container, for example at `/app/ig-ingester`. Set private environment variables:

```
ENABLE_IG_STATEMENT_INGESTER=true
IG_INGEST_FOLDER=/app/ig-ingester
IG_INGEST_USER_ID=<the owning TradeTally user UUID>
```

Keep test and production source folders separate. An enabled environment moves successfully committed PDFs into `Processed` inside its own source folder. Files needing review remain in the input folder; private database receipts prevent repeated imports. File errors are shown on Broker Sync, alongside statement results. The source interface is `list`, `read`, `acknowledge`; a cloud Google Drive API adapter can replace local-folder delivery without changing parsing or financial validation. Cloud API authorization is a separate deployment step, not provided by Drive desktop.

Google Drive's Windows streaming drive may not be visible inside Linux Docker containers. In that case, schedule `scripts/relay-ingestion-folder.ps1 -ConfigFile <private-config.json>` on the host every minute. Its configuration has `source` (the dedicated Drive folder) and `target` (a normal private local staging folder mounted into the app). It copies only checksum-verified PDF/metadata pairs, and archives the cloud originals only after the server archives its committed local copy. Drive desktop must run in the signed-in Windows session. The test task is separate from production; a future cloud deployment should use the Drive API source adapter rather than this Windows relay.

## Validation and coverage

CSV-only reconciliation is one explicit action: select the share account, enable **Reconcile Transactions CSV using saved statements**, choose the export and click **Reconcile and import CSV**. Validation, backup, application, warning resolution and portfolio maintenance then run automatically; no separate apply click is needed. Full report bundles keep their preview/apply workflow. Invalid CSVs stop before application.

After every folder batch the server retries pending share-account reconciliation using all retained imported statement activity. Later statements can reconcile automatically when missing earlier PDFs arrive, regardless of delivery order. Financial application still requires a successful full-ledger dry run, a backup and an unchanged account revision. Actual maintenance failures are retried on subsequent folder checks without replaying financial imports. Previously reviewed files do not consume the twenty-new-statements processing budget. Spread-bet journals and new share executions still require their full report evidence.

Some delayed PDFs can have a reporting-day activity table but a cash summary that includes later movements. A reconciled CSV ledger checks pending receipts only through its verified confirmation date. A contradictory PDF keeps its original evidence and receives a cash-date conflict warning; its matching chart anchor is removed so dated transaction reconstruction can supply the history. When a later statement reconciles to the completed ledger, the earlier activity is matched uniquely and holding identities are unchanged, the receipt is marked resolved by subsequent statement and transaction history. Its active warning clears while original evidence and the exclusion of its conflicting chart anchor remain. Later imports cannot restore that excluded anchor. Independently stored values are retained. No alternate reporting date or balancing transaction is invented. Future ingestion rejects the same mismatch when reconciled history already covers the reporting day.

Share-dealing accounts also support **Reconcile Transactions CSV using saved statements** on Broker Sync. Select the account and enable that option to upload a Transactions CSV without uploading PDFs again. The server merges the export with retained transaction history and verified email activity, preserving existing records and rejecting conflicting references. It checks the result against the latest saved dated statement; it does not invent a balancing cash entry. If the export omits earlier activity needed to reconcile cash, export full history through the statement date. New purchases or sales still need execution evidence through the full-report workflow. Preview and application retain the usual ownership, revision and backup checks.

Match both the PDF account mask and label to exactly one saved account. The email's reporting date can precede the PDF print date, including a weekend. Reconcile cash plus asset value (share dealing) or running P&L (spread betting) to reported equity; spread-bet notional exposure is never portfolio value. Use dated GBP conversion. Existing account/date values must agree to the penny; conflicting corrections remain for review. Unknown layouts and incomplete tables cannot silently succeed.

Unchanged share holdings and recognised non-trade GBP cash activity can update the existing full-history importer. Email cash evidence is retained independently of CSV export references. Later CSV updates resolve a unique matching time, cash amount, type and description to their canonical export identity inside the import transaction, avoiding duplicate income. Missing preceding cash history prevents an automatic financial update; earlier statements or CSV reports must fill it.

Reconciled PDF valuations are independent of cash/journal completeness. If preceding cash history is missing, save the reported dated valuation and mark cash/trade activity as pending reconciliation; never invent a balancing deposit or income entry. Unchanged, verified holding identities can receive newer statement prices, and the portfolio cash card uses the latest dated statement cash. New spread-bet cash activity or opening/closing journal changes that require the full Past Activity/P&L breakdown reports remain for review. New share acquisitions or disposals likewise require execution/CSV evidence. Parsed activity is retained privately; a monthly CSV upload continues to be the full journal reconciliation path. Older uploads cannot overwrite a newer holdings snapshot.

Backups precede financial application. Financial import and its durable receipt commit together. Derived portfolio reconstruction follows the commit; maintenance failure is reported separately and cannot cause duplicate financial postings on retry. Broker Sync shows import status without financial values. Credentials, PDFs, mailbox identifiers and backups must never be committed or included in GitHub issues.

