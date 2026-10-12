# Planning entry checks (#127)

Entry reservations recheck current evidence. Draft and Watching do not reserve capacity. Imported executions and linked fills record trades already placed; these checks do not prevent recording broker history or submit broker orders.

Known account/portfolio risk limits, available-cash limits and quantity, increment, value and holding limits cannot be overridden by a verification reason. Unknown holdings still permit rejection when the entry plus reserved quantity exceeds the entire known holding cap. Fresh broker holdings replace stale saved quantities before checking capacity.

Same-currency comparisons require no FX quote. Cross-currency comparisons with missing FX remain unverified. Missing stop coverage is unknown risk, not zero risk. Manual plan stops remain manual evidence; their date comes from the stop-change event or original baseline, never an unrelated plan edit.

| Integration | Supplied evidence | Limits of verification |
| --- | --- | --- |
| Trading 212 | Account-currency available cash and holdings, usable for 15 minutes; instrument catalogue holding limit, freshness checked against 24 hours | Minimum size/increment and live working stops or borrowing are not established |
| eToro | Fresh native USD cash when pending orders and copied portfolios are explicitly absent; enabled, fixed, non-trailing long stops with leverage 1 and exact position/quantity/currency coverage | Ambiguous orders, disabled/trailing/stale stops and unmatched lots remain unverified; borrowing is not established |
| OKX | Fresh owned native spot cash in the trading wallet; exact-pair public size rules | Funding wallets, liabilities, derivatives and borrowed funds are excluded; missing quote conversion is not assumed |
| Kraken | Fresh native balances after trade holds, excluding credit; exact-pair public size rules | Working stops and borrowing are not established |
| IG / IBKR | Recorded manual rules and limits | Statements/Flex reports do not establish live buying power, working stops or borrowing through the current adapters; current manual verification is required |

Reservations require current trigger, context, protection and data checks plus a recorded verification reason. Manual rule source, date and freshness are retained separately from broker evidence. A stale restriction remains a known restriction but cannot claim current verification. Fresh native cash of zero remains zero; stale broker cash does not override recorded manual capacity.

Verification on TEST includes synthetic PostgreSQL/API cases for IG/IBKR manual evidence, missing FX, stale cash/rules/holdings, known-limit rejection, refreshed holdings, reserved-quantity conservation, incomplete stop coverage and stop-event dates. Existing lifecycle, multi-account, partial-reservation, journal, cashflow and shared-exit suites cover the surrounding workflow. Fixtures are isolated and removed after each run.

Additional live buying-power, working-stop and borrowing adapters remain follow-up scope under #127. Production release requires explicit authorization.
