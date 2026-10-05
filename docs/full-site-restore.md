# Full-site JSON restore

Open **Admin → Backups**, select a full-site `.json` backup, review the restore
options and confirm. Existing JSON exports remain supported. User exports use
Settings → Import instead.

The default restore upload cap is **1 GiB**, independent of the ordinary upload
limit. `BACKUP_MAX_FILE_SIZE` can lower this cap, in bytes; values above 1 GiB
are clamped to the supported ceiling. The screen reads the effective limit
from the server and rejects oversized files before uploading.

Uploads are authenticated and restricted to administrators. Only one restore
can run in an app process at a time. The upload is staged in a private temporary
directory, then parsed incrementally into temporary table files. Complete JSON
syntax and table structure are validated before any database write. A single
record is limited to 16 MiB and nesting to 100 levels. Table rows are read one
at a time inside the existing restore transaction, including dependency retries.
Temporary files are removed after success or failure. Container replacement
also discards temporary files left by a process crash.

The bundled nginx restore location accepts a 1100 MiB request envelope, disables
request buffering and allows 15 minutes for transfer/response inactivity. The
browser restore request and Node request-receipt timeout also allow 15 minutes.
Other upload caps and the normal browser request timeout remain unchanged.
External reverse proxies must permit the same body size and timeout. Their
limits cannot be discovered by the in-app preflight check.

Allow free temporary disk space for both the uploaded JSON and staged rows
(approximately twice the uncompressed export size, plus database/WAL space).
A disk or validation failure must be resolved before retrying. A client timeout
does not prove the transaction stopped; check the server before retrying.
Inspect the restore result for table/record errors: the existing restore engine
reports individual conflicts and skipped records rather than promising every
record was inserted.

Files larger than 1 GiB require the documented PostgreSQL/offsite recovery path
or an operator-managed restore. This upload workflow does not replace recovery
of uploads, application files or environment configuration.
