# IG email statement ingestion

Issue #1. Implement and verify on test before a separately approved production release.

Outlook forwards IG statement emails to Gmail. A user-owned Apps Script copies only permitted PDF attachments into the private **TradeTally ingester** Drive folder. Drive desktop makes the folder available to the local server. The server checks the mounted folder every minute; the cloud exporter checks Gmail every 15 minutes. The server can catch up after downtime.

## Gmail setup

Create an Apps Script project in the Google account receiving the emails. Copy `scripts/ig-email-exporter.gs` into `Code.gs` and `scripts/ig-email-exporter.appsscript.json` into the project's `appsscript.json` manifest. Enable the manifest in Project Settings. Set Script Properties `IG_FOLDER_ID` to the ingestion folder ID and `IG_FORWARDER` to the Outlook sender address. Keep these private configuration values out of Git. Run `collectIgStatements` once, then `installIgTrigger`.

Authorize Gmail **modify** access, Drive access and trigger creation. Gmail modify is required to move messages to Trash; Google grants broader mailbox capabilities than the collector uses. DriveApp requires the broad Drive scope; the script itself writes only the configured private folder. Review the code and permission prompt before approving. Revoke access in Google Account → Security → third-party connections; remove the project trigger to stop collection.

Set Script Property `IG_TRASH_PROCESSED=true` to clean up Gmail copies. The collector moves a matching message to Trash only after all its PDFs and metadata appear in the private `Processed` archive following a committed import or duplicate acknowledgement. Merely exporting to Drive is insufficient. Review/conflict files stay pending; imported valuations with an activity-reconciliation warning are acknowledged because their PDF evidence is preserved. Outlook originals are untouched. The script never permanently deletes messages, sends mail or changes read status. Existing timestamp receipts are upgraded without exporting the same PDF again. Changing from the old read-only scope requires the owner to approve Google's new consent prompt.

The exporter uses message receipts and PDF hashes. It writes a PDF and bounded JSON metadata containing its checksum and reporting date. PDFs with the same filename from different accounts cannot overwrite each other. Original filenames and statement accounts are not public test fixtures.

Message receipts now live in the private Drive `.collector-receipts` folder. Legacy `done:` Script Properties migrate in batches of 25, including receipts for messages already in Trash; they are removed from Properties only after a durable Drive write. Each collector run scans up to 50 messages with a 45-second work budget and resumable page/offset state. A failed message stays in Gmail while other messages continue. The private `.collector-status.json` contains only health counts and timestamps; the relay delivers this health to Broker Sync. Never remove the receipt archive to force replay.

Use a separate Apps Script project for testing, point it to the Test Drive folder, set `IG_TRASH_PROCESSED=false`, and run manually without installing its trigger. In its manifest, use only `gmail.readonly` and `drive` OAuth scopes; omit `script.scriptapp`. The manual collector runs with these scopes, while Trash and trigger installation are unavailable. Production retains its own project, folder and trigger until a separately approved collector rollout.

For an attachment-path smoke test without sending new email, also set `IG_TEST_MODE=true` in that isolated project and run `verifyIgCollectorOnRetainedEmails`. It reads retained daily emails, including Trash, into a separate `Collector validation` child folder in Test. Use a separate temporary relay configuration and test ingestion subfolder to verify duplicate acknowledgement. It never restores or deletes emails. Do not enable this mode in production.

## TradeTally setup

Mount only the dedicated ingestion folder into the app container, for example at `/app/ig-ingester`. Set private environment variables:

```
ENABLE_IG_STATEMENT_INGESTER=true
IG_INGEST_FOLDER=/app/ig-ingester
IG_INGEST_USER_ID=<the owning TradeTally user UUID>
IG_INGEST_REQUIRE_RELAY=true
IG_INGEST_REQUIRE_COLLECTOR=true
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

Manual CSV/PDF applications recheck their saved-account revision inside the advisory-locked transaction after the backup. A changed preview is rejected before financial writes. Recoverable review/rejected PDFs are tried again when saved account/execution evidence or reporting-date metadata changes, or a parser-version change adds support. Unchanged failures stay skipped; backup/FX/transient account-change failures retain their cooldown. Valuation conflicts use the separately guarded ledger/later-statement reconciliation path.

Monthly, quarterly and annual report routing remains follow-up work in issue #88. The daily collector does not interpret those periodic statement subjects.


## Windows relay task without console windows

Use `wscript.exe` as the Task Scheduler action rather than starting PowerShell. Keep `relay-ingestion-folder.vbs` and `relay-ingestion-folder.cjs` together in the environment's private runtime directory. Set the action arguments to `//B //Nologo "<private-runtime>/relay-ingestion-folder.vbs" "<private-config.json>" "<absolute-node.exe>"`. Resolve Node's executable during installation; do not depend on Task Scheduler's PATH. The launcher waits for the relay and returns its exit code without opening a console. Keep the task in the signed-in user's session so Drive desktop is accessible. A task's Hidden setting or PowerShell's hidden-window argument alone does not guarantee a console-free launch.

Back up an existing task's XML privately before updating its action. Preserve its triggers, user, settings and enabled/disabled state; do not enable a user-disabled task during an upgrade. Test the launcher first against synthetic files and a separate private staging folder. Review safe relay health metadata and Task Scheduler's exit result rather than opening a diagnostic console.

At container startup, an enabled IG ingester prepares ownership and owner access on its `Processed` directory only. It does not recursively change the mounted inbox or archived documents. Symlink/non-directory archives are rejected. If archive access is unavailable, folder checks leave statements queued before parsing/importing and show an archive-specific warning. Existing durable receipts still prevent repeat financial postings after a later archive retry.

## Confirmed balances with partly itemised cash activity

For unchanged share holdings, daily email statements can confirm a balance while omitting individual cash movements between statements. The ingester keeps the dated valuation, imports only validated itemised payments with their original transaction identity and dated GBP conversion, and records the remaining difference as cash coverage metadata. It never creates a balancing payment or assumes an unexplained credit is interest. The prior fully reconciled ledger cutoff stays unchanged.

Broker Sync labels these statements **Balance confirmed** with partly itemised cash activity, separately from missing trades or rejected statements. Income shows identified payments and an incomplete-activity notice. Unitemised amounts are excluded from income, trade P&L and plan cashflow links. Partial evidence stays available to cash-ledger views without claiming the ledger reconciles. Repeated folder checks do not repost payments or repeat backups. Later complete evidence uses the existing guarded reconciliation and CSV/email alias matching to clear coverage without double-counting income. A CSV is not required merely to retain verified email balances and itemised payments.
