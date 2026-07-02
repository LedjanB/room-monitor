Hellocare Room Monitor

Open index.html in your browser (or see the live deploy linked in ARCHITECTURE.md).

Originally built as a hospital-room equipment tracker ("Hospital Room Monitor"); now a
general shared room/device status board. Source files still carry the old `v9` name from
that era — see ARCHITECTURE.md's file map for what's actually in each one.

See ARCHITECTURE.md for the full technical writeup (stack, data model, auth,
security rules, known sharp edges, deploy process).

Past changes:
- Added visible Add Bed controls in the room header and Beds sidebar card.
- Added visible Delete buttons for beds in the Beds sidebar.
- Bed delete X is visible directly on beds for admins.
- Add Bed creates a new bed immediately and lets the admin drag it into position.
- Beds remain neutral and do not use status highlighting.
- Visual polish pass: softer room canvas, cleaner cards/panel, lighter grid, refined
  buttons/inputs, and selected-device highlight.
- Migrated to real Firebase Auth/Hosting/RTDB (see ARCHITECTURE.md for the full auth model).
