# Classification metadata and release checks

Crypto categories live in the retained app data volume at `backend/src/data/coingecko-categories.json`, independently of the database and the tracked override files. A database-only promotion does not transfer this metadata. Keep a private backup of the category cache before a release; never commit a cache selected from a user's portfolio.

The test-only `backend/scripts/restoreCryptoCategoryCache.js` accepts a saved cache path. It validates known CoinGecko IDs, category labels and timestamps, preserves newer existing records, skips empty incoming labels, saves the previous cache, and replaces the file atomically. Run it before the test app serves portfolio requests, or restart the test app afterwards so in-memory metadata reloads. It refuses production environments.

Before any later production promotion, obtain explicit approval for the metadata restoration and retain a rollback copy. Compare classifications between environments, in addition to database chart totals. Do not copy broker credentials or account records to resolve missing classification metadata.

The legacy Sector Performance panel reports industry metadata coverage. It only reports background processing when the category scheduler is actively processing; an idle scheduled job or disabled test scheduler has a separate label. “Without industry data” does not indicate failed broker imports. Some provider symbols may still have no industry classification.
