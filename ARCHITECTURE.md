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
- `/state` — anyone logged in can read/write. There's no per-room or per-field granularity;
  any of the ~20 accounts can edit anything. That's a deliberate trade-off for a small
  trusted team, not an oversight.
- `/notifications` — anyone logged in can read, write and prune entries, but entries are
  validated: `message` (string ≤ 500 chars) and `ts` (number, at most 10 minutes in the
  future) are required — so nobody can post an unprunable far-future entry.

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
password, or a regular user willing to bypass the UI via the console (see above). There's
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
5. **Hosting cache headers.** `firebase.json` sets `Cache-Control: no-cache` on every file.
   Without it, browsers cache the HTML/JS for an hour by default, and a user mid-deploy can
   load a broken mix of old and new files. Don't remove this header. The `ignore` list also
   keeps `ARCHITECTURE.md` and `database.rules.json` out of the deploy — they used to be
   publicly served, handing anyone the full security writeup. Don't remove those entries
   either.
6. **`initApp()` must stay idempotent.** It attaches all of the app's `document`-level
   event listeners (clicks, drags, keyboard). It now runs once, unconditionally, at
   startup (before login) so the Sign In / Create Account buttons actually work — a guard
   flag (`_appInitialized`) makes repeat calls a no-op. If you ever see login buttons doing
   nothing again, this is the first thing to check.
7. **Ids must stay globally unique without the counter being in sync.** `uid()`/`noteUid()`
   append a time+random suffix because narrow saves (`saveDeviceState()`) don't sync
   `uidCounter` across clients — with bare counters, two clients could mint the same note
   id and deleting one note deleted both. `applyStatePayload()` also merges the counter
   with `Math.max`, never a plain overwrite.
8. **All time math goes through `serverNow()`** (`data.js`) — status `since` stamps,
   auto-expiry, notification timestamps and pruning. Don't reintroduce bare `Date.now()`
   into any of those paths, or one wrong client clock starts corrupting shared state again.
9. **Form controls that carry `data-action` are handled by the input/change/keydown
   listeners, never by the click handler** — `handleClick()` deliberately skips
   INPUT/SELECT/TEXTAREA action elements. Before that guard, clicking inside the
   rename-device input (whose `data-action="save-dev-name"` exists for the Enter key)
   instantly saved and closed the editor.
10. **The panel's status dropdown is a live preview, not a save.** It mutates in-memory
    state for instant feedback; `savePanel()` persists, and `closePanel()` rolls the
    preview back if the panel is closed without saving (otherwise tiles keep showing a
    status that never reached the server). Failed Firebase writes surface as error toasts
    via `setSyncErrorHandler()` — don't remove that wiring when touching `initApp()`.

## Daily auto-refresh (getting deploys to open tabs)

Hosting is served `no-cache`, but a tab that's *already open* keeps running
the JS it loaded until it reloads — so a fresh deploy doesn't reach someone
who never closes the app. To fix that, every open tab reloads itself once a
day at **10:00 Kosovo time** (`Europe/Belgrade`), scheduled in
`interaction.js` (`scheduleDailyRefresh()`), with the time-of-day derived
from `serverNow()` so a wrong local clock can't fire it early/late. If the
user is mid-action when 10:00 hits — dragging a device, typing in a field,
or a modal/panel is open (`isSafeToReload()`) — the tab does **not** reload
out from under them; it shows the "Updates are ready — please refresh" bar
(`#refreshBar` in `index.html`) and then reloads automatically the moment
they go idle. The bar's "Refresh now" button (`do-refresh`) just calls
`location.reload()`. To change the time, edit `DAILY_REFRESH_HOUR`.

## Responsive layout

The desktop design is a single wide header row plus a two-column corridor next to a
fixed-width sidebar; on phones/tablets that overflowed sideways. A responsive layer at the
end of `hospital_room_monitor_v9.css` (breakpoints at 900 / 600 / 400 px, on top of the
pre-existing 980 px one for the room view) reflows it **without any markup changes** —
render.js still emits the same DOM:

- **Header** wraps instead of overflowing. On phones the search moves to its own full-width
  row (`order:-1`), the informational ROOMS/DEVICES count pills are hidden (the same numbers
  appear in the corridor subheader and room Info card), the username truncates, and the role
  chip drops on very small screens.
- **Search results** become a bottom sheet on phones (`top:auto;bottom:0`, full width),
  decoupled from the now variable-height header so they can't hide behind it.
- **Corridor** keeps its left/right-of-a-hallway metaphor at every size — only the gutter
  (`.floor-row` middle column) and paddings shrink.
- **Room view** stacks the sidebar below the canvas (single column on phones); the **detail
  panel** goes full-width (`100vw`).
- `overflow-x:hidden` on `html,body` under 900 px is a safety net against any stray wide
  child forcing sideways scroll.

If you add a new header control or a new top-level view, re-check it at 375 px — the harness
approach used to verify this (a static HTML file mirroring render.js's markup, screenshotted
at several widths) is the quickest way.

## Deploying changes

No CI/CD — deploys are manual via the Firebase CLI:

```
npx firebase-tools@13 deploy --only hosting --token "$FIREBASE_TOKEN" --project room-monitor-6902b
npx firebase-tools@13 deploy --only database --token "$FIREBASE_TOKEN" --project room-monitor-6902b
```

`$FIREBASE_TOKEN` comes from `npx firebase-tools login:ci` (interactive, one-time, run by a
human — the CLI can't fully log in non-interactively). There's no CI pipeline; every
deploy so far has been run by hand from this environment.
