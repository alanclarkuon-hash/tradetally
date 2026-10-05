# Bug fixes and production changes

- Whenever a bug is discovered, log it as a GitHub issue in `alanclarkuon-hash/tradetally`. Check for an existing issue first and update it instead of creating a duplicate.
- Investigate, reproduce, implement and verify bug fixes in the separate test environment first. Use appropriate tests and check the affected behaviour before proposing a production release.
- Do not push changes to production without the user's explicit authorization for that release. Report the test results and any remaining limitations before requesting approval.
- Keep fixes committed in Git and backed up on GitHub so they can be reverted. Take a backup before major changes or production deployments.
- Keep credentials, broker statements, financial records and private backups out of Git and GitHub, including issue descriptions and logs.
