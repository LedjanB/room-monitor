# Hellocare Room Monitor

A shared, real-time room/device status board. ~20 people (a QA team) use it to see, at a
glance, which rooms/devices are free, in use, or unavailable, and to leave notes for each
other — all synced live across everyone's browser, hosted entirely on Firebase's free
(Spark) tier.

Live at: https://room-monitor-6902b.web.app/
Firebase project: `room-monitor-6902b`

## What it actually is

Originally a hospital-room equipment tracker (rooms → devices: TVs, "Hello" video units,
whiteboards, beds, room signs), repurposed as a shared status board. Each device has a
status (`free` / `inuse` / `not_available`), optionally who's using it, and a note thread.
Beds are the exception: they're furniture, so they have no status, no detail panel and no
serial number (legacy `SN-BD…` values are stripped on load by `stripBedSerial()` in
`data.js`, and the Add Device modal hides the SN field when the type is Bed).
Admins can edit the room/device layout (add/remove rooms, floors, devices, drag devices
around a room canvas); everyone else can update status and leave notes.

## Tech stack — deliberately minimal

- **No build step.** Plain ES modules (`<script type="module">`), loaded directly by the
  browser. No bundler, no npm build, no TypeScript.
- **No local Firebase SDK install for the browser.** `hospital_room_monitor_v9.firebase.js`
  imports the Firebase SDK straight from the `gstatic.com` CDN (pinned to `10.13.2`).
  There are no npm dependencies at all — `package.json` exists only so the `firebase-tools`
  CLI (run via `npx`) has a project root.
- **Firebase Realtime Database** (not Firestore) — the whole app state is basically one
  JSON blob, which maps directly onto RTDB's tree model with minimal code.
- **Firebase Authentication** (email/password, under the hood) for real login.
- **Firebase Hosting** for static file serving.
- All free. No billing account, no Cloud Functions, no server of any kind.

## File map

| File | Role |
|---|---|
| `index.html` | Entry HTML, served by Firebase Hosting. Loads `hospital_room_monitor_v9.js` as a module. |
| `hospital_room_monitor_v9.js` | Entry point. Boots auth, loads state, decides setup/login/app screen. |
| `hospital_room_monitor_v9.firebase.js` | The *only* file that touches the Firebase SDK directly. Exports `db`, `auth`, and re-exports the RTDB/Auth functions everything else uses. Also has `createManagedUser()` — the "create an account without signing yourself out" trick (see Auth section). |
| `hospital_room_monitor_v9.auth.js` | Login/session/user-management logic, built on Firebase Auth + a `/users` profile table. |
| `hospital_room_monitor_v9.data.js` | App state: floors/rooms/devices/positions, load/save, real-time sync, the notification/activity log. |
| `hospital_room_monitor_v9.render.js` | All HTML generation (`render()`, `renderRoom()`, `buildPanel()`, etc.) and drag-to-reposition logic. |
| `hospital_room_monitor_v9.interaction.js` | Event wiring (one delegated click/input/change listener on `document`), all the button/modal actions, toast notifications. |
| `hospital_room_monitor_v9.css` | All styling, including the responsive layer (see below). |
| `firebase.json` | Hosting config (serves the repo root, ignores `node_modules`/`package.json`/etc.) + `no-cache` headers on everything, and points at `database.rules.json` for RTDB rules. |
| `database.rules.json` | Realtime Database security rules (see Security section). |
| `.firebaserc` | Points the Firebase CLI at the `room-monitor-6902b` project. |

## Data model (Realtime Database tree)

```
/meta/initialized      bool   — has the team's first admin account been created?
/users/<uid>            { username, role: 'admin'|'user', createdAt }
/state                  {
                           floors: [{ id, name }],
                           rooms:  [{ id, floorId, name, side, pos, devices: [...], notes: [...] }],
                           devState: { <deviceId>: { status, employee, notAvailableReason,
                                                      customFields, savedFields, notes, since } },
                           positions: { <deviceId>: { x, y } },   // drag positions, % of room canvas
                           state: { currentFloorId, uidCounter, searchFilters },
                           uidCounter,
                         }
/notifications/<pushId> { message, by (uid), byUsername, ts }   — activity feed, see below
```

`/state` is written and read as one whole blob (`set()`/`get()` on the whole node), not
per-field — simple, but see "Known sharp edges" below for what that costs you.

## Device status auto-expiry

Any non-Free status (In Use or Not Available) auto-reverts to Free at the next midnight
**in Kosovo time** (`Europe/Belgrade` — CET/CEST, the same clock as Kosovo; IANA has no
separate Pristina zone), so a status set one day doesn't just sit there into the next, and
everyone sees it expire at the same moment no matter where they're viewing from.
"What time is it" comes from `serverNow()` in `data.js` — the local clock corrected by
RTDB's `.info/serverTimeOffset` — so a machine with a wrong system date can't mass-free
everyone's statuses (a `since` stamped in the future is also clamped rather than treated
as a previous day). `devState[id].since` holds the timestamp of the last status change;
`startDeviceStatusExpiry()` in `data.js` sweeps every device on load and every 30 minutes
(same cooperative, no-backend, whichever-client-is-open pattern as notification pruning —
see below), comparing the Kosovo-calendar day of `since` against today and silently
resetting anything from a previous day to Free (no notification is posted for this, by
design — worst case it's caught within 30 min of midnight, not the instant the clock ticks
over). Data from before this field existed (no `since`) gets a fresh clock starting now
rather than being treated as already-expired.

Quick status cycling: every device tile (except beds, which have no status) has a small
colored dot in the corner (`.dev-quick-toggle` in `render.js`'s `deviceHTML()`) that cycles
Free → In Use → Not Available → Free on click, without opening the full detail panel — for
the common case of just flipping a status. Opening the panel (for notes, employee name, a
"not available" reason) is still a click on the rest of the tile, unchanged. This calls
`commitDeviceStatus()`, not `updateDeviceStatus()` — the latter only updates in-memory state
for the panel's live-preview dropdown (real persistence there is deferred to the panel's
"Save Changes" button, `savePanel()`); a quick-toggle click has no such deferred step, so it
needs its own immediate persist-and-announce, which is what `commitDeviceStatus()` is for.
(An earlier version of the quick-toggle called `updateDeviceStatus()` directly, which meant
the click updated your own screen and showed a toast but was never actually saved to
Firebase or seen by teammates — fixed on this pass.)

"Free Now" (header button, wired to `show-free-now` in `interaction.js`) applies the
existing search-filter panel's status=Free filter across every room/floor in one click —
it's the same filtering `handleSearch()` already did, just given a one-click entry point
for "what's free right now" instead of requiring the filter dropdown.

Because Free Now *is* the search list, both share its ordering: results sort by device type
first (`SEARCH_TYPE_ORDER` in `render.js` — Hello → Whiteboard → TV → Room Sign → Bed), then
floor, room and label, with a heading per type group so the priority reads as deliberate.
Clicking a result runs `goToDevice()`, which now also scrolls the tile into view and replays
an attention pulse on it (`updateSelectedDeviceVisual({ reveal: true })`) — opening the panel
alone told you *what* you picked but not *which tile on the canvas* it was. The selection
ring is an `outline`, not a `box-shadow`, specifically because the per-status shadow rules
further down the CSS all carry `!important` and would otherwise paint over it.

## Auth model — why it's more than it looks

The login/setup screens use plain username + password, but under the hood every account
is a **real Firebase Authentication** account. Usernames are mapped to fake emails
(`username@hrm.local`) since Firebase's email/password auth needs an email shape — users
never see this.

Why not just a simple hand-rolled auth table (which is what this app had before)? Because
the Realtime Database rules need something real to check (`auth != null`), otherwise the
database would have to be either fully open (readable/writable by anyone with the URL) or
impossible to lock down without a backend. Real Firebase Auth gets real access control for
free.

**Only admins can create accounts** (no public sign-up) — enforced two ways:
1. The UI only exposes account creation via the admin-only "Manage Users" panel.
2. The database rules (see below) require an admin-provisioned `/users/<uid>` profile to
   exist before that uid can do anything. Someone who creates a raw Firebase Auth identity
   directly (the API key is public — that's normal for Firebase) gets no profile and
   **cannot create one themselves**: the only self-write the rules allow is the very first
   admin's, and that path is gated on `meta/initialized` not yet being `true`. (An earlier
   version of the rules left that bootstrap exception open forever, which meant anyone on
   the internet could self-provision an admin profile — fixed.)

**The "create a teammate without logging yourself out" trick**: Firebase's client SDK
normally signs you in as whatever account you just created with
`createUserWithEmailAndPassword`. That's wrong for "admin adds a colleague." The fix
(`createManagedUser()` in `hospital_room_monitor_v9.firebase.js`) spins up a second,
throwaway Firebase app instance, creates the user there, signs that instance out, and
deletes it — leaving the admin's actual session on the primary app instance untouched.

**Known limitation**: removing a user only deletes their `/users/<uid>` profile (which
immediately revokes all app access — they can never log in again since login requires a
matching profile). Their underlying Firebase Auth identity isn't deleted, because that
requires the Firebase Admin SDK (a backend), which isn't in the picture on purpose (keeps
this 100% free/serverless). If you want a fully clean slate, Firebase Console →
Authentication → Users lets you bulk-delete manually.

## Real-time sync

- On login, `startLiveSync()` (in `interaction.js`) calls `loadRemoteState()` (one-time
  fetch) then `subscribeRemoteState()` (an RTDB `onValue` listener on `/state`) — every
  client's listener fires on every write, including their own (the "echo").
- A guard flag (`applyingRemote`) stops the echo of your own save from re-triggering
  another save (no infinite loop).
- `state.currentRoom` is deliberately **not** reset on every live update — only on a true
  fresh page load (`resetNav: true`). Live updates re-point it at the fresh copy of the
  same room by id, so you don't get bounced back to the corridor view every time anyone
  (including you) saves a change. This was a real bug once — see git history / past
  conversation for the exact symptom if it ever regresses.
- Drag-in-progress is protected: the live-update handler skips re-rendering while
  `document.querySelector('.dragging')` — an in-flight remote update won't yank the DOM
  out from under an active drag.
- Same protection applies while a text field is focused (an `<input>`/`<textarea>` —
  employee name, note body, unavailable reason, search) — a teammate's save is still
  applied to in-memory state, it just doesn't redraw until you're no longer typing.
  Otherwise a well-timed remote update would wipe out whatever you were mid-typing, the
  same failure mode the drag guard exists for.

## Notes (room + device) — authorship and 48h lifetime

Notes are short-lived coordination messages, not a permanent log. Two rules govern them:

**Who can delete one.** `canDeleteNote()` in `render.js` is the single source of truth,
used both to decide whether to render the × button and re-checked in `deleteNote()`
(`interaction.js`) so a stale/tampered DOM can't bypass it. An admin can delete any note;
everyone else only their own. New notes carry `authorId` (the author's Firebase uid) —
that's what's matched. Notes written before that field existed only have the `author`
username string, so those fall back to a case-insensitive username comparison. If
`authorId` is present it wins outright, so renaming/reusing a username can't hand someone
else's notes to a new account.

**They expire after 48 hours.** `NOTE_TTL_MS` in `data.js`, swept by `runNoteExpiry()` —
the same cooperative, no-backend pattern as the notification prune and the device-status
expiry: whichever client has the app open does the work. It runs on initial load, on every
remote snapshot (a snapshot re-delivers notes another client hasn't pruned yet, so a
one-shot sweep at startup would get clobbered — exactly the reasoning in the device-expiry
section above), and on the 30-minute sweep timer, which it shares with
`startDeviceStatusExpiry()`.

Persistence is split because the two kinds of note live in different places: device notes
are in `devState/<id>` and go out through a scoped `set(state/devState/<id>)`; room notes
live in the structural `rooms` tree and go out through a scoped `set(state/rooms)` — not a
whole-tree `saveState()`. Like `persistExpiryCorrections()`, this deliberately bypasses the
`applyingRemote` guard, or the expired notes would live on the server forever. It's
idempotent (a second pass finds nothing) and only writes when something actually expired.
A note with a missing or unparseable `createdAt` is treated as **fresh**, never silently
deleted. Creation stamps use `serverNow()`, same as everything else time-sensitive.

## Notifications (the bell icon)

Two layers, both driven by `/notifications`. **Current coverage: notes and status changes**
— adding a room/device note (`addNote()` in `interaction.js`) and changing a device's status
(`announceStatusChange()` in `render.js`, called from `savePanel()` and `commitDeviceStatus()`)
both call `broadcastActivity()`. Layout edits (add/remove room, floor, device) and user
management don't generate a notification. If you want that covered too, that's a product
decision (more calls to `broadcastActivity()`), not a bug.
1. **Toast popups** — instant, in-session, shown for new notes or status changes from a
   teammate. Shown via
   the existing toast stack (capped at 4 visible so a burst of simultaneous edits can't pile
   up and block the UI).
2. **Bell dropdown** — a 12-hour rolling history ("Recent Activity"), with an unread-count
   badge (tracked per-browser in `localStorage`, not shared).

**Cleanup with no backend**: entries older than 12h get deleted by whichever client reads
them next — on `subscribeNotifications()`'s initial load, and again every 30 minutes while
any tab stays open. No cron job, no Cloud Function, no cost. As long as at least one
teammate opens the app now and then, nothing accumulates past ~12h.

## Security rules — what's actually protected and what isn't

`database.rules.json`, in plain terms:
- `/meta/initialized` — publicly readable (needed so a not-yet-logged-in browser can show
  "set up the first admin" vs. "sign in"). Writable while it isn't `true` yet (the setup
  flow sets it), and after that **only by admins** — a regular user can't flip it back to
  re-open the setup screen. Must be a boolean.
- `/users` — the full list is only readable by admins (so random logged-in users can't
  enumerate everyone's username); your *own* `/users/<your-uid>` is always readable (needed
  for login to fetch your role). Writing your own profile is only allowed during first-run
  setup (profile doesn't exist yet AND `meta/initialized` isn't `true`) — after that, only
  an existing admin can write any profile (including their own). Profiles are validated:
  `username` (string, 1–60 chars) and `role` (`admin`|`user`) are required.
- `/state` and `/notifications` — readable and writable by any account **that has an
  admin-provisioned `/users/<uid>` profile**. Note the second half: `auth != null` alone is
  *not* enough, and that distinction is the whole point of the check.

  **Why (this was a real hole, fixed):** these two nodes used to be gated on a bare
  `auth != null`. But the Firebase Web API key is public (it ships in the browser bundle —
  that's normal and unavoidable), and the project has email/password **self-signup enabled**,
  because the app's own "Add User" flow calls the client-side
  `createUserWithEmailAndPassword`. So anyone who viewed the page source could mint their own
  Auth identity in a single HTTP request and then read and write every room, device, status
  and note, plus delete the whole activity feed. The `/users` rules correctly stopped them
  from self-provisioning a *profile*, so the app's UI locked them out — but the database
  never asked for one. The UI was the only thing standing in the way, which is exactly the
  thing rules exist not to rely on.

  The same gap silently broke **"Remove User"**: deleting someone's profile revokes app
  access (login refuses them), but their underlying Auth account survives by design — so
  under the old rules a departed teammate could still sign in with their old password and
  keep full read/write on `/state` via the REST API. Requiring a profile is what actually
  makes removal effective.

  Don't relax these back to `auth != null`. If self-signup is ever disabled in the console,
  the check is still worth keeping — it's what makes user removal real.

  Within that gate there's still no per-room or per-field granularity: any of the ~20
  provisioned accounts can edit anything. That part remains a deliberate trade-off for a
  small trusted team (see the admin-only note below).

  `/notifications` entries are additionally validated: `message` (string ≤ 500 chars) and
  `ts` (number, at most 10 minutes in the future) are required — so nobody can post an
  unprunable far-future entry.

**Admin-only actions (room/floor/device layout, deleting notes) are enforced in the app's
own JS** (`isAdminRole()` checks in `interaction.js`, gating every structural handler), not
by the database rules — the rules only require *some* logged-in account, any role. This is
a real, structural limit, not just an unfinished corner: `saveState()` writes the entire
`/state` node in one `set()`, and that exact write path is shared by admin-only structural
edits (delete a room) and everyone-allowed edits (add a note) — both look identical to the
rules engine (same node, same operation), and RTDB rules cascade permission downward (a
child rule can only grant *more* access than its parent, never less). So there's no rule
that can block the former for non-admins without also blocking the latter for everyone.
Closing this fully would mean splitting notes out of the `rooms`/`devState` structural
payload so each has its own write path the rules *can* tell apart — a data-model change,
deliberately not done. Net effect: a regular "user" account who bypasses the UI entirely
(e.g. via the browser console) and writes to `/state` directly still has full structural
power despite the UI hiding those buttons. Accepted for a small trusted team; revisit if
that stops being true.

**What this does *not* protect against**: a malicious *admin* account, a leaked admin
password, or a provisioned regular user willing to bypass the UI via the console (see
above). It *does* now protect against a stranger who mints their own Firebase Auth
identity with the public API key, and against a removed teammate reusing their old
password — both had full database access until the `/state` and `/notifications` rules
started requiring a profile. There's
no audit trail beyond the 12h notification log, and no Cloud-Functions-enforced business
logic — all validation happens client-side. Acceptable for a free, 20-person internal tool;
would need rethinking if this ever handled anything actually sensitive or adversarial.

## Known sharp edges (things that will bite you again if you forget them)

1. **Firebase RTDB silently drops empty arrays/objects.** Save a room with `devices: []`
   and read it back — the `devices` key is just gone, not `[]`. Every place that reads
   room/device data from Firebase must default missing arrays back to `[]`
   (`applyStatePayload()` in `data.js` does this now) — don't remove that normalization.
2. **Whole-tree `/state` writes can clobber concurrent edits — but only for the paths that
   still use them.** The high-frequency edits already write *narrow, path-scoped* subtrees:
   a device status/employee/reason/custom-fields/device-notes change goes through
   `saveDeviceState()` → `set(state/devState/<id>)`, and a drag goes through
   `saveDevicePosition()` → `set(state/positions/<id>)`. Those can't clobber each other or
   the room layout. What still does a full-tree `set()` (via `saveState()`) is the
   *structural* stuff: add/remove/rename room or floor, reorder rooms, add/delete a device,
   and **room** notes (they live in the `rooms` tree). Two people doing those at nearly the
   same moment, with one's local copy stale, can still overwrite each other — this bit us
   once (a room briefly lost most of its data during heavy testing). Low real-world risk for
   a 20-person team, but if it becomes a real complaint the remaining fix is to move room
   notes and structural edits onto their own scoped `update()` paths too.
3. **Reseeding an empty `/state` must use the pristine `DEFAULT_ROOMS`/`DEFAULT_FLOORS`
   snapshot** (captured at module load, before anything can mutate it) — never the live,
   possibly `localStorage`-tainted `rooms`/`floors` arrays. Otherwise whichever browser
   happens to load first after a reset reseeds everyone with its own stale cached data.
4. **Drag clamping vs. render clamping must agree.** Some device types (bed, TV,
   whiteboard, hello) render their box slightly smaller than `dev.w`/`dev.h` for visual
   padding (`sizeScale` in `deviceHTML()`). The position clamp (`pos()` in `data.js`) has
   to use that *same* scaled size, or a drag that looks valid snaps back after the next
   sync. If you ever add a new device type with its own `sizeScale`, make sure `pos()`
   still gets called with the scaled width/height, not the raw one.
5. **Devices on the room canvas are overlapping rectangles, and stack order is what
   decides who gets the click.** A Hello sits on the top edge of a TV, and its `.device`
   box is padded well beyond the drawn glyph, so with everything at one z-index the DOM
   order silently decided which one you hit — clicking a Hello usually opened the TV. Two
   things fix it, both at the end of the CSS: only the drawn shape takes pointer events
   (`.device{pointer-events:none}` plus an explicit allow-list of shape children — don't
   add a new device type's shape without adding it there), and z-index runs
   smallest-target-first (bed 4 → tv 8 → whiteboard 12 → roomsign 20 → hello 30). Hover
   lifts a tile only *within* its tier, so a hovered TV can never rise above the Hellos on
   top of it. Related: **hover may grow a tile but must never move one.** Hover applies
   `transform:scale(…)` to everything except TVs (they're the biggest tiles and the Hellos
   sit on their top edge, so an expanding TV would swallow them). A pure scale from the
   centre is safe because the box only ever grows — a cursor that's on the tile stays on
   it. The old `translateY(-2px) scale(1.01)` slid the box out from under the cursor, which
   un-hovered it, which slid it back; that oscillation is what made small devices feel like
   they refused to be selected. Don't reintroduce a translate. Because the hover scale
   changes the rendered box, `onPointerDown()` adds `.no-hover-fx` (which forces
   `transform:none`) *before* calling `getBoundingClientRect()` — the grab offset is
   measured there and then applied to the untransformed box during the drag, so measuring a
   scaled tile makes it jump under the cursor the moment a drag starts.
6. **The toast stack sits exactly on top of the panel's sticky Save Changes bar.** Both
   are bottom-right and fixed. Toasts are therefore `pointer-events:none`, otherwise a
   toast physically blocks the button underneath until it fades. Nothing in a toast is interactive; if that ever
   changes, the bar needs to move instead.
7. **A modal's header must not scroll.** `.modal` is a flex column with `overflow:hidden`
   and only `.modal-body` scrolls; header and footer are fixed rows. Before that, `.modal`
   was the scroll container itself, so a long list (Recent Activity) scrolled its own ×
   out of reach. Modals also close on a backdrop click, guarded on the *pointerdown*
   target so a text selection that starts inside the dialog and ends outside doesn't
   dismiss it.
8. **Hosting cache headers.** `firebase.json` sets `Cache-Control: no-cache` on every file.
   Without it, browsers cache the HTML/JS for an hour by default, and a user mid-deploy can
   load a broken mix of old and new files. Don't remove this header. The `ignore` list also
   keeps `ARCHITECTURE.md` and `database.rules.json` out of the deploy — they used to be
   publicly served, handing anyone the full security writeup. Don't remove those entries
   either.

   **`**/.*` does NOT exclude the *contents* of dot-directories.** It matches files whose
   basename starts with a dot, so `.git/config` (basename `config`) sailed straight past it.
   Since `"public": "."`, the whole `.git` directory was being uploaded and served —
   `/.git/config`, `/.git/HEAD` and the object store were all publicly fetchable, meaning
   the complete history of a *private* repo, including the very `ARCHITECTURE.md` this
   ignore list exists to withhold, was downloadable by anyone with the site URL.
   `.firebase/` and `.claude/` leaked the same way. The fix is the additional `**/.*/**`
   entry, which covers directory contents rather than just the entry itself.

   **A healthy deploy reports `found 9 files`.** If `firebase deploy` ever prints a count in
   the thousands, it is uploading `.git` — stop and fix the ignore list before releasing.
   Re-verify after any change to it:

   ```
   curl -o /dev/null -w '%{http_code}\n' https://room-monitor-6902b.web.app/.git/config   # must be 404
   ```
9. **`initApp()` must stay idempotent.** It attaches all of the app's `document`-level
   event listeners (clicks, drags, keyboard). It now runs once, unconditionally, at
   startup (before login) so the Sign In / Create Account buttons actually work — a guard
   flag (`_appInitialized`) makes repeat calls a no-op. If you ever see login buttons doing
   nothing again, this is the first thing to check.
10. **Ids must stay globally unique without the counter being in sync.** `uid()`/`noteUid()`
   append a time+random suffix because narrow saves (`saveDeviceState()`) don't sync
   `uidCounter` across clients — with bare counters, two clients could mint the same note
   id and deleting one note deleted both. `applyStatePayload()` also merges the counter
   with `Math.max`, never a plain overwrite.
11. **All time math goes through `serverNow()`** (`data.js`) — status `since` stamps,
   auto-expiry, notification timestamps and pruning. Don't reintroduce bare `Date.now()`
   into any of those paths, or one wrong client clock starts corrupting shared state again.
12. **Form controls that carry `data-action` are handled by the input/change/keydown
   listeners, never by the click handler** — `handleClick()` deliberately skips
   INPUT/SELECT/TEXTAREA action elements. Before that guard, clicking inside the
   rename-device input (whose `data-action="save-dev-name"` exists for the Enter key)
   instantly saved and closed the editor.
13. **Status saves immediately.** The panel's three status buttons (`pick-status`) call
    `commitDeviceStatus()`, same as the tile's quick dot. "In use by" and "Reason" save on
    their own while typing (debounced, flushed when the panel closes). The Save Changes bar
    is now only for new custom fields; closing the panel discards half-typed custom fields
    and nothing else.
14. **`[title]{position:relative}` (the old tooltip rule) beats any same-specificity
    `position:absolute` that comes before it in the file.** That's how the status dot ended
    up in normal flow: on top of each tile and, on a TV, under the Hello. It's now forced
    back to absolute, and the drawings keep a 20px `margin-top` *only when the dot is
    present*, because every live layout was arranged with that offset baked in. Removing
    the margin shifts every device on the board 20px up.
15. **Browser Back never leaves the app.** `initBackButtonGuard()` keeps one extra history
    entry; Back pops it, `stepBackInApp()` closes the topmost thing (dialog, note editor,
    search, device panel, then room → floor), and the entry is put back.
16. **Theme.** `data-theme="light|dark"` on `<html>`, set before first paint by the inline
    script in `index.html` and kept in sync by `applyTheme()` (render.js). The header
    button cycles Auto → Light → Dark, stored in `localStorage` (`hrm-theme`). All dark
    styles are `:root[data-theme="dark"] …` overrides at the end of the CSS.
16. **Edit floor is the floor manager.** `renderFloorManager()` (interaction.js) lists both
    sides of the corridor in order; move up/down, switch side, rename, delete and add all
    go through `moveRoomToSlot()` / `addRoomAt()` and save immediately. Top of a list = start
    of the corridor. Room/device totals for the floor are shown there (not in the header).
17. **Adding a room.** Admins get one extra empty row at the end of the corridor; the first
    empty spot on each side shows "+ Add room here", which opens Add room with that side
    and spot preselected. Add room asks for side (Left/Right) and "Where" (at the start /
    after room X) instead of a raw position number.
18. **Recently deleted.** Deleting a floor, room or device first copies it (with its
    devices' devState and positions) into `trash` (data.js), which is part of the `/state`
    payload, so `saveState()` carries it and no rule change was needed. Entries expire
    after 30 days (`pruneTrash()`). Undo on the toast and Settings → Recently deleted both
    call `restoreFromTrash()`. Old clients that don't know about `trash` will drop it on
    their next whole-tree save, so deploy before relying on it.
19. **Device history.** `devState[id].history` (newest first, max 30 entries, 30 days),
    added by `commitDeviceStatus()` and by the midnight auto-free. Shown in the device panel.
20. **Settings** (gear in the header): theme (stored per browser, `hrm-theme`), teammate
    popups on/off (`hrm-popups`), and Recently deleted for admins.
21. **Floor plan layout.** `floor.layout` is `'corridor'` (default, the straight two-sided
    view) or `'free'` ("Floor plan" in the UI). In floor plan mode each room has
    `room.box {x,y,w,h}` in % of a canvas shaped by `floor.aspect` (height/width); the
    corridor is just the floor left between rooms. Rooms are tinted by status (any in use =
    red, any not available = orange, else green). `renderFreeFloor()` draws it. Admins use
    Edit layout (`state.layoutEditing`, this tab only): click to select (handles + Rename /
    Open / Delete popover), drag to move, handles to resize, drag on empty floor to draw a
    new room (named straight away), Delete key removes. Everything snaps to a 1% grid and
    to other rooms' walls. Walls behave like a real plan (`linkedWall()`): dragging one
    side of a room also moves that side of every room lined up with it in an unbroken row,
    and the facing side of rooms across that wall. That's how the corridor is widened. Switching to Floor plan runs `convertFloorToFree()` (left-side
    rooms along the top, right-side along the bottom); switching back keeps the boxes.
22. **Corridors.** Straight view: "Resize corridor" shows a handle that sets
    `floor.corridorWidth` (px). Floor plan view: corridors are real shapes,
    `floor.corridors [{id,x,y,w,h}]`, drawn under the rooms. In Edit layout (or via the
    "Resize corridor" button, which opens the editor with the corridor selected) they're
    selected, moved and resized with the same 8 handles as rooms; moving a corridor edge
    pushes the row of rooms on that side (`corridorWall()` → `linkedWall()`/`applyWall()`).
    "+ Corridor" adds another piece (for turns/branches), Delete removes one.
23. **Resize floor.** The "Resize floor" button (admins, both layouts) shows handles on the
    floor's edges and bottom corners. Width → `floor.viewWidth` (px, the box is centred so
    it grows on both sides); height → `floor.rowHeight` (straight view, min room-card
    height) or `floor.aspect` (floor plan). The straight view also shows the hallway-width
    handle (`floor.corridorWidth`) in the same mode.
