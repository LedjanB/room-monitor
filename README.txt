Hellocare Room Monitor

Use the live deploy: https://room-monitor-6902b.web.app/ (linked in ARCHITECTURE.md).
To run locally, serve the folder over HTTP (e.g. `npx http-server`) and open the printed
URL — don't just double-click index.html, because the app loads ES modules and talks to
Firebase, which browsers block over the file:// protocol.

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
- Security: closed a hole where anyone with the public API key could self-provision an
  admin profile; locked the setup flag; added database validation rules; stopped deploying
  ARCHITECTURE.md / rules to the public site.
- Reliability: all timestamps now use a server-corrected clock (a wrong local clock can no
  longer mass-expire everyone's statuses); device-status auto-expiry now happens at midnight
  Kosovo time (Europe/Belgrade); unique ids are collision-proof across clients; failed saves
  now show an error instead of a false "saved".
- UX: fixed the rename box closing on click; the status dropdown no longer claims "saved"
  before you press Save Changes (and unsaved previews roll back on close); saved custom
  fields can be deleted; Enter submits every modal; friendlier login errors.
- Added a daily auto-refresh: open tabs reload at 10:00 Kosovo time to pick up new deploys,
  with a "please refresh" bar as a fallback if you're mid-action.
- Cleanup: removed dead code and the unused node_modules/firebase dependency.
- New-deploy detection: open tabs notice a deploy (version.json marker) and show the
  "please refresh" bar — checked when the tab returns to view, cheap on the free tier.
- Made the whole UI responsive for phones/tablets (wrapping header, search bottom sheet,
  taller room canvas with tappable devices, full-width panel).
- Device lists are now tappable with inline status toggles (room sidebar + search results);
  fixed the results panel not scrolling for long lists.
- Per-floor "X Free · Y In Use" summary in the corridor header.
- Colorblind-safe status: symbols on toggles (✓/–/✕) and shape-coded dots.
- Polish: Esc closes overlays, password Show/Hide, "connection lost" indicator.
