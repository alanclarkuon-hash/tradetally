# Runtime logs and backups

Native installs default to per-user state outside the source checkout:

- Windows: `%LOCALAPPDATA%/TradeTally/logs` and `backups`.
- Linux/macOS: `${XDG_STATE_HOME:-$HOME/.local/state}/tradetally/logs` and `backups`.

Set `TRADETALLY_STATE_DIR` to an absolute external directory for both, or use
`LOG_DIR` and `BACKUP_DIR` individually. Paths inside this or another Git
checkout, including symlink targets, are rejected before creating runtime files.
The account running the service needs write access. Keep directory permissions
restricted to that account. Do not store private environment files in source.

Docker uses dedicated volumes at `/app/backend/src/logs` and
`/app/backend/src/data`; backups remain in the latter's `backups` directory.
The local and test compose projects retain their existing volume identities and
backup paths. The generic and development compose files use named volumes for
logs, data and uploads, including when source code is mounted for development.
The image declares anonymous volumes for standalone Docker runs; use named
volumes for predictable retention and recovery.

## Updating an existing generic/development installation

Do not switch an existing installation from bind mounts to empty named volumes
without migrating its files. Stop its writers, retain a private database backup
and a verified copy of existing log/data/upload directories outside every
checkout, then populate the corresponding named volumes before starting the
updated application. Verify attachment access and existing backup downloads.
Keep the original private copy until recovery has been checked. This is not
needed for local/test projects that already use the same named volumes.
Changing a native backup directory does not rewrite old database file paths;
move existing archives and reconcile their recorded paths before switching it.

Backup and PostgreSQL maintenance scripts now default to external per-user
storage. Explicit output paths must be absolute and outside checkouts. Supply
the old *external* migration backup directory explicitly when rolling back an
earlier migration. No migration/restore is performed automatically.
