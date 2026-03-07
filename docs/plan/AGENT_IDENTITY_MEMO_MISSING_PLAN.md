# Agent Identity Memo Missing Plan

## Scope
- Fix missing identity memo on agent detail page after agent profile updates.
- Validate identity aggregation triggers and memo retrieval for agent detail view.

## Plan
1. Review agent detail memo tab data flow and rendering logic. (frontend)
2. Verify identity memo aggregation is triggered on agent updates and written to memo storage. (backend)
3. Check memo API filtering and response mapping for memoKind=identity. (backend)
4. Adjust frontend memo tab to display identity memo when available. (frontend)
5. Add/update tests and update docs if behavior changes. (test/docs)

## Risks / Dependencies
- Missing aggregation events or cached memo refresh can delay identity visibility.
- Existing filters may hide identity memos on detail view.
