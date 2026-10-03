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

## Local correction file

Edit `backend/config/stock-classification-overrides.json`. The file starts empty; no company assignments are changed until an entry is supplied. For example:

```json
{
  "version": 1,
  "overrides": {
    "MSFT": {
      "industry_code": "451030",
      "reason": "Reviewed: Software industry"
    }
  }
}
```

Use the exact uppercase symbol, including exchange suffix. The six-digit industry code derives its four-digit group and two-digit sector and all three names from the bundled hierarchy. You may include explicit `sector_code`, `sector_name`, `industry_group_code`, `industry_group_name` or `industry_name`, but they must agree with that branch. Codes must be quoted strings. An optional `reason` explains the correction. No sub-industry is used.

The file overrides FinanceDatabase for display and grouping only. It never overwrites database rows, provider labels or financial calculations. The Assets page marks the result Manual override and offers the original provider classification for comparison. Valid entries still work if another entry is invalid; malformed JSON falls back to provider data with a visible warning.

The test compose file mounts this file read-only inside the app. Save it and refresh the Assets/Portfolio page to apply changes, without rebuilding or restarting. Removing an entry restores the provider on the next page refresh. The existing 30-day FinanceDatabase refresh cannot overwrite a correction because overrides are applied after provider reads and writes. If this is later deployed elsewhere, mount the same file or rebuild the image after edits. Production deployment still requires explicit approval.

The correction file is versioned in Git so public classification decisions can be reviewed and reverted. Put only symbols, classification fields and a non-sensitive reason in it; never account identifiers, financial records or credentials.

## Crypto and fund category corrections

`backend/config/category-classification-overrides.json` uses version 1 with `overrides.crypto` and `overrides.fund` objects. Each exact symbol entry contains `category`, `reason`, and an HTTPS `source_url`. These labels are manual display themes, not stock GICS codes. They keep Crypto assets and Funds & ETFs as separate top-level groups. Provider labels remain available, and deleting an entry restores provider grouping on refresh. Invalid entries or malformed files fall back with a visible warning.

The October 2026 review covers current holdings only. Changes include missing crypto themes from CoinGecko and more specific fund mandates from issuer documents. Broad Yahoo fund categories are not necessarily incorrect; an override can express a more useful thematic grouping. No fund look-through or valuation changes are made. CoinGecko categories overlap: one theme is selected for the heatmap, with AI/RWA/DeFi priority generally retained. Celestia uses Data Availability; Polkadot and Cosmos use Layer 0. NEAR retains its existing AI theme.

Nine stock corrections include current GICS parent names/codes, telecom/financial misclassifications, and legacy symbols. F5's change to Software took effect on 30 September 2026. NBIS's IT Services assignment is inferred from the current issuer business description. VACQ's Aerospace & Defense grouping uses the Rocket Lab successor business, while retaining the legacy symbol. NVTKL.L is treated as the legacy Novatek gas-company listing. These three are explicitly marked for owner review; no official current GICS assignment is claimed for them.

All review entries include public sources and dates in their reasons. The Assets page shows the correction, source and original provider labels. Review these there or edit the two JSON files. The test-only configuration directory mount makes subsequent label edits available without rebuilding. The October review adds no financial records, quantities, balances or account identifiers to Git.
