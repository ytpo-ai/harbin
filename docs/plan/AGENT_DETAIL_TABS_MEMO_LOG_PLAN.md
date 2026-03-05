# Agent Detail Tabs Memo Log Plan

## Scope
- Add agent detail page tabs for memo and log views.
- Memo tab supports managing and viewing agent memos.
- Log tab shows all logs for the agent.

## Plan
1. Locate agent detail route and page layout to insert a tabbed interface for "备忘录" and "日志". (frontend/router)
2. Implement the tab UI and shared layout container for the new sections. (frontend/ui)
3. Wire memo tab to existing memo data sources or define new API/state handling if missing. (frontend/state, backend/api if needed)
4. Wire log tab to existing agent log APIs with list rendering and pagination/sort. (frontend/state, backend/api if needed)
5. Update tests and docs if behavior or API surface changes. (test/docs)

## Risks / Dependencies
- Need to confirm existing memo and log endpoints/data models; may require new API work.
