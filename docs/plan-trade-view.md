# Plan-linked trade details

Tracked in #100, PR #97. The existing `/trades/:id` page displays the position defined by a linked plan, using its explicit entry and exit allocations. Links from planning specify `planId`. A directly opened source trade with exactly one associated plan resolves the same position for its owner. Unlinked and public trade views retain their existing scope. With several associated plans, explicit plan context is required; do not merge different plans.

Combine source partitions with the same plan row, action, time, price and contract into one displayed execution. Preserve allocated units and costs; use the verified plan ledger and broker account settlements for realised results. Both detail and chart endpoints use this projection. Show every linked entry and exit on the chart, including partial exits while the position remains open. Changed source evidence must be reconciled rather than plotted as valid.

Keep source broker records unchanged. The combined page links to Manage plan and Open original broker record, and hides source editing/splitting controls. The raw edit API remains scoped to the original source. The separate plan-trade modal was removed following user review. Stable broker partition reconciliation remains tracked under #94.
