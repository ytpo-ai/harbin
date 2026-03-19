# Frontend Sidebar Collapse and Icon Dedup Plan

## Scope
- Support collapse/expand interaction for first-level sidebar menus.
- Replace duplicated first-level menu icons with distinct, semantically matched icons.
- Keep existing route structure and permission behavior unchanged.

## Plan
1. Audit current sidebar rendering and first-level menu configuration to identify where expand state and icons are defined (frontend).
2. Introduce first-level menu collapse state keyed by menu group, defaulting to expanded for the group that contains the active route (frontend).
3. Add first-level toggle interaction and visual affordance (expand/collapse indicator), while preserving current child menu click navigation (frontend).
4. Refactor icon mapping for first-level menus to remove repeated icon usage and ensure each group has a unique visual identity (frontend).
5. Verify desktop and narrow-width behavior, route active highlight, and collapse interaction consistency (frontend/test).
6. Update relevant feature and daily log documentation to record this navigation interaction and icon cleanup adjustment (docs).

## Impact
- `frontend` sidebar navigation rendering and interaction details.
- No backend API, database schema, or orchestration logic changes.

## Risks & Dependencies
- Active-route based auto-expand logic must remain stable on refresh and direct deep-link entry.
- Icon updates should stay consistent with current Ant Design-based visual language.
