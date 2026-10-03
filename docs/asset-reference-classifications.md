# Supplemental stock classifications (prototype)

The prototype stores reference classifications in `asset_reference_classifications`, separate from TradeTally's native provider profiles. No `symbol_categories`, enrichment, price, trade, holding or cashflow fields are overwritten.

FinanceDatabase supplies sector, industry group and industry names. Codes are mapped only when each name matches the corresponding branch of the published MSCI GICS structure. Codes are stored as strings with lengths of 2, 4 and 6. There is no sub-industry enrichment. Unrecognised names retain their source label and have no invented code. Conflicting entries have no classification. Missing exact symbols remain unclassified.

Sources:

- [FinanceDatabase equity datasets](https://github.com/JerBouma/FinanceDatabase/tree/main/database/equities) (community maintained; not live market data).
- [FinanceDatabase category definitions](https://github.com/JerBouma/FinanceDatabase/blob/main/CONTRIBUTING.md#category-definitions).
- [MSCI GICS structure](https://www.msci.com/documents/1296102/23c8ec04-fd1c-3518-e04c-4aa37027889d), structure effective March 2023, definitions updated February 2025. The bundled reference contains names and codes only, not the descriptive definitions. GICS is a trademark of MSCI and S&P.

Lookups preserve exchange suffixes. Known regional suffixes use their corresponding exchange dataset; unsupported suffixes remain unclassified. US listings are searched across US equity datasets. No approximate ticker matching, ISIN import, company-description guessing or Yahoo-to-GICS conversion is used. Crypto and fund classifications retain their existing providers.

The portfolio refresh enriches missing/stale stock classifications, and the existing symbol categorisation job also updates this independent table when background jobs are enabled. Downloads are shared per exchange for 24 hours; saved records are refreshed after 30 days. Outages preserve the last saved record. The Assets page itself remains a saved-data-only view.

The heatmap hierarchy is Stocks → Sector → Industry → Holding. Industry group is stored and shown on the Assets page but is not an extra heatmap level. Funds & ETFs and crypto retain their own subgroups. Missing source labels are grouped under Unclassified. Account, currency and date filters still control the same valuations; classification enrichment does not change financial calculations.

Code matching validates the taxonomy label, not the company's assignment. The source dataset can contain incorrect or obsolete labels (the October 2026 lookup, for example, assigned PANW to Financials). Both Assets and the portfolio explicitly identify these as community reference classifications. Native provider labels remain separately available for comparison. No inferred corrections are written. Supplemental job failures do not stop native categorisation.

Rollout is test-only. Migration 271 creates the separate table. `backend/scripts/enrichAssetClassifications.js` refuses to write unless both the app environment and database name identify the isolated test server. Do not deploy this prototype to production without the owner's explicit approval. Database backups remain outside Git.
