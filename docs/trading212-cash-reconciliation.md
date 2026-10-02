# Trading 212 cash reconciliation

Total wallet cash includes `availableToTrade`, `reservedForOrders` and uninvested `inPies` cash from the account summary. Pie cash must not be omitted merely because the broker includes it in its investment summary.

Trade wallet `netValue` already includes taxes and currency-conversion fees. Do not subtract those charges a second time. Splits move share quantities without moving wallet cash.

The JSON transactions endpoint can label corporate-action reservations and releases as withdrawals and deposits, and dividend tax adjustments as deposits. The CSV export supplies the missing descriptions. `trading212StatementAnnotations.importStatementAnnotations(connection, csv)` annotates existing owner-scoped API transaction IDs after verifying their date, currency and original amount. It does not create new payments. Supply the complete reservation and execution history together; unmatched executions are rejected.

For an executed rights subscription, the reservation already removed the cash. Its matching release is consumed by execution and has zero net wallet movement. Both entries are classified as corporate actions rather than external funding. Rights-sale proceeds are corporate-action cash; dividend adjustments are dividend income. Original API amounts remain in private database metadata. Subsequent syncs preserve these annotations and reject conflicting API amounts instead of silently replacing them.

Keep downloaded CSV reports and statement descriptions in private application data, outside Git and Docker build contexts. Take a database backup before annotating history. Other CSV actions are left unchanged; new corporate actions may require further statement review when the JSON API lacks their explanation.

API reference: [Trading 212 OpenAPI specification](https://docs.trading212.com/_bundle/api.json?download=).
