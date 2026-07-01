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
  imports the Firebase SDK straight from the `gstatic.com` CDN (pinned to `10.13.2`). The
  `firebase` npm package in `package.json`/`node_modules` is *not* what actually runs in
  the browser — it's just sitting there from before this was wired up. It's harmless but
  you could remove it; nothing imports it.
- **Firebase Realtime Database** (not Firestore) — the whole app state is basically one
  JSON blob, which maps directly onto RTDB's tree model with minimal code.
- **Firebase Authentication** (email/password, under the hood) for real login.
- **Firebase Hosting** for static file serving.
- All free. No billing account, no Cloud Functions, no server of any kind.

## File map

| File | Role |
|---|---|
| `index.html` / `hospital_room_monitor_v9.html` | Identical entry HTML (kept in sync manually — see below). Loads `hospital_room_monitor_v9.js` as a module. |
| `hospital_room_monitor_v9.js` | Entry point. Boots auth, loads state, decides setup/login/app screen. |
| `hospital_room_monitor_v9.firebase.js` | The *only* file that touches the Firebase SDK directly. Exports `db`, `auth`, and re-exports the RTDB/Auth functions everything else uses. Also has `createManagedUser()` — the "create an account without signing yourself out" trick (see Auth section). |
| `hospital_room_monitor_v9.auth.js` | Login/session/user-management logic, built on Firebase Auth + a `/users` profile table. |
| `hospital_room_monitor_v9.data.js` | App state: floors/rooms/devices/positions, load/save, real-time sync, the notification/activity log. |
| `hospital_room_monitor_v9.render.js` | All HTML generation (`render()`, `renderRoom()`, `buildPanel()`, etc.) and drag-to-reposition logic. |
| `hospital_room_monitor_v9.interaction.js` | Event wiring (one delegated click/input/change listener on `document`), all the button/modal actions, toast notifications. |
| `hospital_room_monitor_v9.css` | All styling. |
| `firebase.json` | Hosting config (serves the repo root, ignores `node_modules`/`package.json`/etc.) + `no-cache` headers on everything, and points at `database.rules.json` for RTDB rules. |
| `database.rules.json` | Realtime Database security rules (see Security section). |
| `.firebaserc` | Points the Firebase CLI at the `room-monitor-6902b` project. |

**Why two identical HTML files?** `index.html` is what Firebase Hosting serves by default;
`hospital_room_monitor_v9.html` is a legacy artifact from before hosting was set up. Both
must be edited together — there's no templating, just keep them identical.

## Data model (Realtime Database tree)

```
/meta/initialized      bool   — has the team's first admin account been created?
/users/<uid>            { username, role: 'admin'|'user', createdAt }
/state                  {
                           floors: [{ id, name }],
                           rooms:  [{ id, floorId, name, side, pos, devices: [...], notes: [...] }],
                           devState: { <deviceId>: { status, employee, notAvailableReason,
                                                      customFields, savedFields, notes } },
                           positions: { <deviceId>: { x, y } },   // drag positions, % of room canvas
                           state: { currentFloorId, uidCounter, searchFilters },
                           uidCounter,
                         }
/notifications/<pushId> { message, by (uid), byUsername, ts }   — activity feed, see below
```

`/state` is written and read as one whole blob (`set()`/`get()` on the whole node), not
per-field — simple, but see "Known sharp edges" below for what that costs you.

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
   exist before that uid can do anything — so even if someone found a way to create a raw
   Firebase Auth identity directly, they'd have no profile and the app would refuse them.

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

## Notifications (the bell icon)

Two layers, both driven by `/notifications`:
1. **Toast popups** — instant, in-session, for "so-and-so just changed X." Shown via the
   existing toast stack (capped at 4 visible so a burst of simultaneous edits can't pile
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
  "set up the first admin" vs. "sign in"), writable only when logged in.
- `/users` — the full list is only readable by admins (so random logged-in users can't
  enumerate everyone's username); your *own* `/users/<your-uid>` is always readable (needed
  for login to fetch your role). Writing your own profile is only allowed once, when it
  doesn't exist yet (the very first admin's self-provisioning during setup) — after that,
  only an existing admin can write any profile (including their own).
- `/state`, `/notifications` — anyone logged in can read/write. There's no per-room or
  per-field granularity; any of the ~20 accounts can edit anything. That's a deliberate
  trade-off for a small trusted team, not an oversight — tightening it further would mean
  per-path rules keyed to roles, which is more rule complexity for a scenario (an internal
  QA tool with known users) that doesn't need it.

**What this does *not* protect against**: a malicious *admin* account, or a leaked
admin password. There's no audit trail beyond the 12h notification log, and no
Cloud-Functions-enforced business logic — all validation happens client-side. Acceptable
for a free, 20-person internal tool; would need rethinking if this ever handled anything
actually sensitive or adversarial.

## Known sharp edges (things that will bite you again if you forget them)

1. **Firebase RTDB silently drops empty arrays/objects.** Save a room with `devices: []`
   and read it back — the `devices` key is just gone, not `[]`. Every place that reads
   room/device data from Firebase must default missing arrays back to `[]`
   (`applyStatePayload()` in `data.js` does this now) — don't remove that normalization.
2. **Whole-tree `/state` writes can clobber concurrent edits.** `saveState()` does a full
   `set()` of the entire rooms/devState/positions tree, not a per-field update. Two people
   editing at nearly the same moment, if one's local copy is stale, can overwrite the
   other's change. This bit us once already (a room briefly lost most of its data during
   heavy testing). Low real-world risk for a 20-person team clicking one status at a time,
   but if data loss becomes a real complaint, the fix is moving to per-path `update()`
   calls (e.g. `devState/<id>` written independently of `rooms`) instead of one big `set()`.
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
   load a broken mix of old and new files. Don't remove this header.
6. **`initApp()` must stay idempotent.** It attaches all of the app's `document`-level
   event listeners (clicks, drags, keyboard). It now runs once, unconditionally, at
   startup (before login) so the Sign In / Create Account buttons actually work — a guard
   flag (`_appInitialized`) makes repeat calls a no-op. If you ever see login buttons doing
   nothing again, this is the first thing to check.

## Deploying changes

No CI/CD — deploys are manual via the Firebase CLI:

```
npx firebase-tools@13 deploy --only hosting --token "$FIREBASE_TOKEN" --project room-monitor-6902b
npx firebase-tools@13 deploy --only database --token "$FIREBASE_TOKEN" --project room-monitor-6902b
```

`$FIREBASE_TOKEN` comes from `npx firebase-tools login:ci` (interactive, one-time, run by a
human — the CLI can't fully log in non-interactively). There's no CI pipeline; every
deploy so far has been run by hand from this environment.
