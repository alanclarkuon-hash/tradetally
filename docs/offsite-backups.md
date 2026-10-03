# Private off-PC backups on Windows

`scripts/backup-offsite.ps1` runs a daily backup for `compose.local.yaml`.
The Windows scheduled task is local machine configuration, not a Codex automation.
Google Drive for desktop must be signed in and Docker Desktop must be running.
Missed runs catch up when Windows is available, with retries for unavailable dependencies.

Each encrypted `.ttbackup` contains a PostgreSQL custom-format dump, retained uploads
and application data, `.env`, Compose configuration, and an integrity manifest.
Existing backup archives are excluded to avoid recursive growth. The database dump
uses a consistent PostgreSQL snapshot. Retained files are copied while the app runs.

Archives use AES-256-GCM with a random nonce. The recovery key lives in
`.local/backup-secrets/recovery.key`, protected by Windows access controls.
**Save that key in a password manager or other safe place outside this PC.**
Google Drive does not receive the recovery key. The encrypted archive includes
the broker encryption settings needed to recover saved broker credentials.

Private files under `.local` are excluded from Git and Docker build context.
Never commit keys, `.env`, dumps or backups. Copying to the Drive folder confirms
only local synchronization handoff; confirm cloud upload separately in Drive.
The workflow retains the latest 30 matching backup archives in that folder.
Other files in the folder are left alone. A successful local run is recorded in
`.local/backup-secrets/last-success.json`; scheduled failures return a nonzero code.

To make a backup manually, run the PowerShell wrapper. To verify an encrypted
archive, run `node scripts/verify-offsite-backup.cjs <absolute-backup-path>`.
Verification decrypts to a protected temporary directory and restores into the
fixed disposable database `tradetally_offsite_restore_check`. It never replaces
the live database and fails if that disposable database already exists.
After verification, the temporary database and decrypted files are removed.

For recovery onto another PC, install the matching PostgreSQL version and Docker,
decrypt with the separately saved key, validate the manifest, and restore the
database/files/settings into an isolated installation first. Keep automatic broker
sync disabled until the restored installation is verified and the previous instance
has been stopped. Production replacement is a separate, deliberate action.
