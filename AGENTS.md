# Bug fixes and production changes

- Before implementing any change, including features, design changes and bug fixes, log a GitHub issue in `alanclarkuon-hash/tradetally`. Check for an existing issue first and update it instead of creating a duplicate. Link the implementation PR to the issue. Implement and verify changes on test first; production requires explicit release authorization.
- Whenever a bug is discovered, log it as a GitHub issue in `alanclarkuon-hash/tradetally`. Check for an existing issue first and update it instead of creating a duplicate.
- Investigate, reproduce, implement and verify bug fixes in the separate test environment first. Use appropriate tests and check the affected behaviour before proposing a production release.
- Do not push changes to production without the user's explicit authorization for that release. Report the test results and any remaining limitations before requesting approval.
- Keep fixes committed in Git and backed up on GitHub so they can be reverted. Take a backup before major changes or production deployments.
- Keep credentials, broker statements, financial records and private backups out of Git and GitHub, including issue descriptions and logs.

# Private data storage

- Never place private, personal or financial data anywhere inside a repository checkout or Git worktree, even temporarily or when the files are Git-ignored or untracked. `.gitignore` is not a privacy boundary.
- This applies to credentials, API keys, tokens, environment files containing secrets, recovery keys, broker statements, email attachments, financial exports, database dumps, private backups, screenshots, diagnostic output and logs containing private data. Download, extraction, backup and restore staging must also stay outside the repository.
- Use external private storage for both test and production, currently `%USERPROFILE%\TradeTally\Private\test` and `%USERPROFILE%\TradeTally\Private\production`. Keep appropriate access restrictions on these directories. Database and application data may remain in Docker volumes outside the checkout.
- Repository files may contain code, synthetic test fixtures and placeholder-only configuration examples. Reference external private paths without copying their contents into Git, GitHub issues, PR descriptions or public logs.
- Before creating or downloading potentially private files, verify the resolved destination is outside every repository checkout and worktree. If private files are discovered inside a checkout, stop writing there, report the finding and arrange verified relocation while preserving active service and backup dependencies.