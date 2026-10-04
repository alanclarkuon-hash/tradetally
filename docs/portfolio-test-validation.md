# Portfolio maintenance validation

Validated on 4 October 2026 on the isolated local test server, using the
`codex/portfolio-dashboard-prototype` branch after commit `d318c9e7`.
Production was not deployed or modified. Automatic test syncs remain disabled.
A private test database backup was taken before manual sync validation.

## Automated checks

- 341 backend tests passed across 41 suites covering portfolio history,
  reconstruction, broker imports, statement handling and reconciliation.
- Seven frontend tests passed for chart data and heatmap layouts.

## Fresh manual API syncs into test

| Broker | Result | Portfolio maintenance |
| --- | --- | --- |
| IBKR | Completed without warnings | Dated NAV history retained; weekend handling completed without warnings. No live value was stamped onto a non-reporting day. |
| Trading 212 | Completed without warnings | Today's value captured; recent history rebuilt without gaps. |
| OKX | Completed without warnings | Today's spot portfolio captured; recent history rebuilt without gaps. |
| Kraken | Completed with existing accounting warnings | Native reconciliation passed; today's value captured; recent history rebuilt without gaps. |
| eToro | Completed with its API history limitation warning | Current API import completed. Statements remain necessary for older history and cashflow/income coverage. |

Kraken's copied test connection had a stale error status. Its retained snapshot
passed a reconciliation dry run before that test-only status was cleared and a
fresh manual sync was attempted. Its warnings concern legacy-token price
estimates and unavailable original acquisition basis for incoming crypto.

IG remains statement-driven. Existing statements and labelled carry-forward
values were checked; no fresh IG statement was supplied in this validation.

## Data and browser checks

- All nine managed-account chart filters returned only their selected account,
  with unique dates and finite non-null values.
- Combined USD history equalled the sum of individual histories on all 1,799
  available dates, within rounding tolerance. No missing combined dates were
  reported in available coverage. This includes explicitly labelled estimates;
  continuity does not mean every historical value is independently verified.
- Recent GBP history respected its requested date range.
- Repeated fresh Kraken/OKX captures updated the same day without creating
  duplicate observations.
- Browser checks covered all accounts, Kraken-only selection, all-time and
  monthly ranges, and GBP/USD display. The test banner remained visible.

## Presentation follow-up (resolved)

The summary cards now show balances only. The portfolio-over-time card has an
“Include deposits & withdrawals” checkbox, checked by default. Checked displays
the chart's total portfolio change; unchecked displays current holdings'
unrealised P&L for the selected range. This is not total change minus funding,
which would also include realised gains and income. Missing reliable P&L is
shown as unavailable. The chart line continues to show portfolio value.
The focused frontend checks pass all 15 tests. Portfolio chrome uses the shared
Trading Dashboard styles.

Some holdings' period P&L remains unavailable when reliable price or lot coverage
is missing. Existing historical-price, migration and manual-statement estimates
remain labelled. IG email ingestion is tracked separately.

Private backups, screenshots, broker payloads and financial records are excluded
from this report and remain outside Git.
