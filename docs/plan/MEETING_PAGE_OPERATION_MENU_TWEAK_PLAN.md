# Plan: Meeting page operation menu tweaks

## Scope
- Move “open in new tab” action into the meeting operations menu.
- Place the operations collapse toggle to the right of the operations button group.
- Preserve current behavior for status actions and collapse state.

## Steps
1. Locate meeting operation header layout and collapse toggle placement. (frontend)
2. Move the “open new tab” action into the operations dropdown. (frontend)
3. Reorder the collapse toggle to the right of operations buttons. (frontend)
4. Verify click/close behavior for the menu and collapse toggle. (frontend)

## Impact
- Frontend meeting page UI layout.

## Risks/Dependencies
- Ensure menu click handlers do not conflict with collapse toggle or other buttons.
