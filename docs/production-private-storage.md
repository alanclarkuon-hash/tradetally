# Production private storage

Production configuration is outside the repository at `%USERPROFILE%\TradeTally\Private\production\config\production.env`. The recovery key, destination configuration, backup status and scheduler log are under `production\backup-secrets`; encrypted backups and temporary plaintext staging are under `production\backup-output` and `production\backup-staging`.

Use `scripts\production-compose.ps1` to run production Compose commands, for example `scripts\production-compose.ps1 ps` or `scripts\production-compose.ps1 up -d`. It supplies the external environment file and preserves the `tradetally-local` project and existing Docker volumes. `TRADETALLY_PRIVATE_DIR` can specify a different external private root.

The Windows scheduled task continues to invoke `scripts\backup-offsite.ps1` at its existing times. It reads the external destination and status, and invokes the encrypted backup script using the external production environment. Preserve the recovery key when relocating files: old encrypted backups require the same key. Google Drive copy verification confirms local file checksums; it does not confirm cloud upload completion.

Database and application records remain in Docker named volumes. Moving host configuration and backup files does not require recreating containers. Keep original files until checksums, Compose resolution, an encrypted backup and restore verification have passed.