# Agent Identity Memo Missing Plan

## Scope
- Complete missing fields in Agent identity memo: `agent name`, `工具描述`.
- Tool permission display is deferred for now.

## Plan
1. Inspect identity aggregation pipeline and confirm available data sources for agent info, tool metadata, and role tool permission set. (backend)
2. Update identity memo template and mapping to include explicit `agent name` in Agent Profile section. (backend)
3. Add tool capability section details:
   - `工具描述`: resolve from tool registry metadata (fallback to default message). (backend)
4. Update identity memo payload/source markers to reflect added dependency (`tool_registry`). (backend)
5. Add unit tests for identity content rendering to cover:
   - normal case with tool metadata,
   - fallback case when tool metadata is missing,
   - empty tool scenarios. (test)
6. Update `docs/feature/AGENT_MEMO.md` identity template description for the new fields and run targeted test validation. (docs/test)

## Key Impact
- Backend: `modules/memos/identity-aggregation.service.ts`
- Data source: `Tool` collection
- Test: identity aggregation unit tests
- Docs: `docs/feature/AGENT_MEMO.md`

## Risks / Dependencies
- Tool description consistency depends on registry completeness; missing items require graceful fallback text.
