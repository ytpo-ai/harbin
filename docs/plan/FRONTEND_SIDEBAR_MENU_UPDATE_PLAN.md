# Frontend Sidebar Menu Update Plan

## Scope
- Update frontend left sidebar to support collapse/expand
- Convert to two-level menu structure
- Group agent/skills/tools/model/memo items under a single parent menu
- Promote dashboard and meetings to first-level menu entries

## Plan
1. Inspect current sidebar component, menu config, and routing map to confirm existing entries and active-state logic (frontend)
2. Define first-level menu list with Dashboard and Meetings promoted to top-level, preserving other groups (frontend)
3. Implement collapsible sidebar behavior with state, animation, and layout adjustments (frontend)
4. Refactor menu data to support top-level items plus grouped sections and regroup child entries under the new parent (frontend)
5. Verify navigation, active highlighting, and permissions; update or add tests if needed (frontend/test)
6. Review README/docs for any required updates and adjust if menu changes affect usage (docs)

## Impact
- Frontend navigation structure and interaction
- Potential route-active highlight logic and permissions checks

## Risks & Dependencies
- Must map existing routes to new menu hierarchy to avoid missing entries
- Ensure collapse state does not break responsive layout
