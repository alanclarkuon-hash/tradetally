# Plan-linked trade details

Tracked in #100, PR #97. The existing `/trades/:id` page displays the position defined by a linked plan, using its explicit entry and exit allocations. Links from planning specify `planId`. A directly opened source trade with exactly one associated plan resolves the same position for its owner. Unlinked and public trade views retain their existing scope. With several associated plans, explicit plan context is required; do not merge different plans.

Combine source partitions with the same plan row, action, time, price and contract into one displayed execution. Preserve allocated units and costs; use the verified plan ledger and broker account settlements for realised results. Both detail and chart endpoints use this projection. Show every linked entry and exit on the chart, including partial exits while the position remains open. Changed source evidence must be reconciled rather than plotted as valid.

Keep source broker records unchanged. The combined page links to Manage plan and Open original broker record, and hides source editing/splitting controls. The raw edit API remains scoped to the original source. The separate plan-trade modal was removed following user review. Stable broker partition reconciliation remains tracked under #94.

Original broker trade pages no longer show the Correct matched exits card. Review the entries and exits explicitly linked to the plan through the combined trade detail page. Removing the card does not change broker matching or stored allocations.

## Original broker execution linking

Trading 212 share plans present original broker executions once in the linking picker, rather than the automatic matched trade partitions. Stored execution identities combine the quantities and fees across long/short matched records and unassigned detached exits; price, time, account currency and broker FX must agree. The picker shows the full original quantity and, when old links use a portion, the remaining quantity available. Fully allocated executions and executions already linked through the new original-source key are excluded.

New links store a stable original-execution key and snapshot; existing source trade IDs serve only as navigation anchors. Workflow, review and the plan-linked trade/chart hydrate that execution independently of its matched partitions. Existing allocations retain their quantities and source snapshots; there is no automatic relinking or broker trade rewrite. Linking validates owner, account, asset, instrument, original evidence and cross-plan quantities inside the planning transaction. Later changes to original evidence continue to require reconciliation. Unlinking an original execution releases its plan allocation without altering broker matching. Other brokers retain their existing execution finder. This change is tracked in #94 and tested before production release.
