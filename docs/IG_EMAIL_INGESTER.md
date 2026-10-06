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

Match both the PDF account mask and label to exactly one saved account. The email's reporting date can precede the PDF print date, including a weekend. Reconcile cash plus asset value (share dealing) or running P&L (spread betting) to reported equity; spread-bet notional exposure is never portfolio value. Use dated GBP conversion. Existing account/date values must agree to the penny; conflicting corrections remain for review. Unknown layouts and incomplete tables cannot silently succeed.

Unchanged share holdings and recognised non-trade GBP cash activity can update the existing full-history importer. Email cash evidence is retained independently of CSV export references. Later CSV updates resolve a unique matching time, cash amount, type and description to their canonical export identity inside the import transaction, avoiding duplicate income. Missing preceding cash history prevents an automatic financial update; earlier statements or CSV reports must fill it.

Reconciled PDF valuations are independent of cash/journal completeness. If preceding cash history is missing, save the reported dated valuation and mark cash/trade activity as pending reconciliation; never invent a balancing deposit or income entry. Unchanged, verified holding identities can receive newer statement prices, and the portfolio cash card uses the latest dated statement cash. New spread-bet cash activity or opening/closing journal changes that require the full Past Activity/P&L breakdown reports remain for review. New share acquisitions or disposals likewise require execution/CSV evidence. Parsed activity is retained privately; a monthly CSV upload continues to be the full journal reconciliation path. Older uploads cannot overwrite a newer holdings snapshot.

Backups precede financial application. Financial import and its durable receipt commit together. Derived portfolio reconstruction follows the commit; maintenance failure is reported separately and cannot cause duplicate financial postings on retry. Broker Sync shows import status without financial values. Credentials, PDFs, mailbox identifiers and backups must never be committed or included in GitHub issues.
