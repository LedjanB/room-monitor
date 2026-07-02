import {
  isAdminSession,
  isLoggedIn,
  getAuthSession,
} from './hospital_room_monitor_v9.auth.js';
import {
  db, ref, get, set, push, onValue, onChildAdded, onChildRemoved, remove,
} from './hospital_room_monitor_v9.firebase.js';

export const STATUS = {
  FREE: 'free',
  IN_USE: 'inuse',
  NOT_AVAILABLE: 'not_available',
};

// currentFloorId/searchFilters are per-browser UI state (which floor tab
// you're looking at, what you've typed into search) — never written to the
// shared Firebase /state blob and never overwritten by teammates' saves.
// See LOCAL_UI_STORAGE_KEY below. Only floors/rooms/devState/positions/
// uidCounter are actual shared team data.
export const state = {
  currentFloorId: 'f1',
  currentRoom: null,
  editingRoomId: null,
  editingFloorId: null,
  uidCounter: 1000,
  searchFilters: {
    floorId: 'all',
    room: '',
    type: 'all',
    status: 'all',
  },
};

export function isAdmin() {
  return isAdminSession();
}

export function canEditStructure() {
  return isAdmin();
}

export function canUpdateStatus() {
  return isLoggedIn(); // both admin and user can update device status
}

export function canAddNotes() {
  return isLoggedIn(); // both admin and user can add notes
}

export function uid(prefix = 'dev') {
  return prefix + (++state.uidCounter);
}

export function noteUid() {
  return 'note' + (++state.uidCounter);
}

export const floors = [
  { id:'f1', name:'Floor 1 - Corridor A' },
  { id:'f2', name:'Floor 2 - Corridor B' },
];

export const rooms = [
  { id:'r1', floorId:'f1', name:'Dhoma 1', side:'left',  pos:1, devices:[
    { id:'r1-tv1',  type:'tv',         label:'TV 1',        sn:'SN-TV10001', x:3,  y:5,  w:30, h:24 },
    { id:'r1-h1',   type:'hello',      label:'Hello 1',     sn:'SN-HL10001', x:3,  y:0,  w:9,  h:6  },
    { id:'r1-h2',   type:'hello',      label:'Hello 2',     sn:'SN-HL10002', x:13, y:0,  w:9,  h:6  },
    { id:'r1-tv2',  type:'tv',         label:'TV 2',        sn:'SN-TV10002', x:65, y:5,  w:30, h:24 },
    { id:'r1-h3',   type:'hello',      label:'Hello 3',     sn:'SN-HL10003', x:65, y:0,  w:9,  h:6  },
    { id:'r1-h4',   type:'hello',      label:'Hello 4',     sn:'SN-HL10004', x:75, y:0,  w:9,  h:6  },
    { id:'r1-bed1', type:'bed',        label:'Bed 1',       sn:'SN-BD10001', x:4,  y:36, w:22, h:54 },
    { id:'r1-bed2', type:'bed',        label:'Bed 2',       sn:'SN-BD10002', x:70, y:36, w:22, h:54 },
    { id:'r1-rs1',  type:'roomsign',   label:'Room Sign',   sn:'SN-RS10001', x:44, y:0,  w:6,  h:8 },
  ]},
  { id:'r2', floorId:'f1', name:'Dhoma 2', side:'right', pos:1, devices:[
    { id:'r2-tv1',  type:'tv',         label:'TV 1',        sn:'SN-TV20001', x:3,  y:5,  w:30, h:24 },
    { id:'r2-h1',   type:'hello',      label:'Hello 1',     sn:'SN-HL20001', x:3,  y:0,  w:9,  h:6  },
    { id:'r2-h2',   type:'hello',      label:'Hello 2',     sn:'SN-HL20002', x:13, y:0,  w:9,  h:6  },
    { id:'r2-wb1',  type:'whiteboard', label:'Whiteboard',  sn:'SN-WB20001', x:63, y:4,  w:12, h:26 },
    { id:'r2-wh1',  type:'hello',      label:'Hello WB',    sn:'SN-HL20003', x:63, y:0,  w:9,  h:5  },
    { id:'r2-bed1', type:'bed',        label:'Bed 1',       sn:'SN-BD20001', x:35, y:36, w:22, h:54 },
    { id:'r2-rs1',  type:'roomsign',   label:'Room Sign',   sn:'SN-RS20001', x:44, y:0,  w:6,  h:8 },
  ]},
  { id:'r3', floorId:'f1', name:'Dhoma 3', side:'left',  pos:2, devices:[
    { id:'r3-tv1',  type:'tv',         label:'TV 1',        sn:'SN-TV30001', x:3,  y:5,  w:30, h:24 },
    { id:'r3-h1',   type:'hello',      label:'Hello 1',     sn:'SN-HL30001', x:3,  y:0,  w:9,  h:6  },
    { id:'r3-h2',   type:'hello',      label:'Hello 2',     sn:'SN-HL30002', x:13, y:0,  w:9,  h:6  },
    { id:'r3-wb1',  type:'whiteboard', label:'Whiteboard',  sn:'SN-WB30001', x:63, y:4,  w:12, h:26 },
    { id:'r3-wh1',  type:'hello',      label:'Hello WB',    sn:'SN-HL30003', x:63, y:0,  w:9,  h:5  },
    { id:'r3-bed1', type:'bed',        label:'Bed 1',       sn:'SN-BD30001', x:35, y:36, w:22, h:54 },
  ]},
  { id:'r4', floorId:'f1', name:'Dhoma 4', side:'right', pos:2, devices:[
    { id:'r4-tv1',  type:'tv',         label:'TV 1',        sn:'SN-TV40001', x:3,  y:5,  w:28, h:23 },
    { id:'r4-h1',   type:'hello',      label:'Hello 1',     sn:'SN-HL40001', x:3,  y:0,  w:9,  h:6  },
    { id:'r4-h2',   type:'hello',      label:'Hello 2',     sn:'SN-HL40002', x:13, y:0,  w:9,  h:6  },
    { id:'r4-wb1',  type:'whiteboard', label:'Whiteboard 1',sn:'SN-WB40001', x:38, y:4,  w:12, h:26 },
    { id:'r4-bed1', type:'bed',        label:'Bed 1',       sn:'SN-BD40001', x:3,  y:38, w:20, h:52 },
    { id:'r4-bed2', type:'bed',        label:'Bed 2',       sn:'SN-BD40002', x:73, y:38, w:20, h:52 },
  ]},
  { id:'r5', floorId:'f1', name:'Dhoma 5', side:'left',  pos:3, devices:[
    { id:'r5-tv1',  type:'tv',         label:'TV 1',        sn:'SN-TV50001', x:3,  y:5,  w:30, h:24 },
    { id:'r5-h1',   type:'hello',      label:'Hello 1',     sn:'SN-HL50001', x:3,  y:0,  w:9,  h:6  },
    { id:'r5-h2',   type:'hello',      label:'Hello 2',     sn:'SN-HL50002', x:13, y:0,  w:9,  h:6  },
    { id:'r5-tv2',  type:'tv',         label:'TV 2',        sn:'SN-TV50002', x:62, y:5,  w:30, h:24 },
    { id:'r5-bed1', type:'bed',        label:'Bed 1',       sn:'SN-BD50001', x:35, y:36, w:22, h:54 },
    { id:'r5-rs1',  type:'roomsign',   label:'Room Sign',   sn:'SN-RS50001', x:44, y:0,  w:6,  h:8 },
  ]},
  { id:'r6', floorId:'f1', name:'Dhoma 6', side:'right', pos:3, devices:[
    { id:'r6-tv1',  type:'tv',         label:'TV 1',        sn:'SN-TV60001', x:3,  y:5,  w:30, h:24 },
    { id:'r6-h1',   type:'hello',      label:'Hello 1',     sn:'SN-HL60001', x:3,  y:0,  w:9,  h:6  },
    { id:'r6-wb1',  type:'whiteboard', label:'Whiteboard',  sn:'SN-WB60001', x:63, y:4,  w:12, h:26 },
    { id:'r6-bed1', type:'bed',        label:'Bed 1',       sn:'SN-BD60001', x:35, y:36, w:22, h:54 },
  ]},
  { id:'r7', floorId:'f1', name:'Dhoma 7', side:'right', pos:4, devices:[
    { id:'r7-tv1',  type:'tv',         label:'TV 1',        sn:'SN-TV70001', x:3,  y:5,  w:30, h:24 },
    { id:'r7-h1',   type:'hello',      label:'Hello 1',     sn:'SN-HL70001', x:3,  y:0,  w:9,  h:6  },
    { id:'r7-bed1', type:'bed',        label:'Bed 1',       sn:'SN-BD70001', x:35, y:36, w:22, h:54 },
  ]},
  { id:'r8', floorId:'f2', name:'Dhoma A1', side:'left', pos:1, devices:[
    { id:'r8-tv1',  type:'tv',   label:'TV 1',    sn:'SN-TV80001', x:3,  y:5,  w:30, h:24 },
    { id:'r8-h1',   type:'hello',label:'Hello 1', sn:'SN-HL80001', x:3,  y:0,  w:9,  h:6  },
    { id:'r8-bed1', type:'bed',  label:'Bed 1',   sn:'SN-BD80001', x:35, y:36, w:22, h:54 },
    { id:'r8-rs1',  type:'roomsign',label:'Room Sign',sn:'SN-RS80001',x:44,y:0, w:6,h:8 },
  ]},
  { id:'r9', floorId:'f2', name:'Dhoma A2', side:'right', pos:1, devices:[
    { id:'r9-tv1',  type:'tv',   label:'TV 1',    sn:'SN-TV90001', x:3,  y:5,  w:30, h:24 },
    { id:'r9-h1',   type:'hello',label:'Hello 1', sn:'SN-HL90001', x:3,  y:0,  w:9,  h:6  },
    { id:'r9-bed1', type:'bed',  label:'Bed 1',   sn:'SN-BD90001', x:35, y:36, w:22, h:54 },
  ]},
];

// Pristine copy, captured before anything (localStorage cache, Firebase
// sync) can mutate the live `rooms`/`floors` arrays above. Reseeding an
// empty database must always use this, never the live arrays — otherwise
// whichever browser happens to load first reseeds from its own possibly
// stale local cache instead of the real default layout.
const DEFAULT_FLOORS = JSON.parse(JSON.stringify(floors));
const DEFAULT_ROOMS = JSON.parse(JSON.stringify(rooms));

export const devState = {};

export function normalizeDevState(entry = {}) {
  const status = entry.status || (entry.inUse ? STATUS.IN_USE : STATUS.FREE);
  return {
    status: Object.values(STATUS).includes(status) ? status : STATUS.FREE,
    inUse: status === STATUS.IN_USE,
    employee: entry.employee || '',
    notAvailableReason: entry.notAvailableReason || entry.reason || '',
    customFields: Array.isArray(entry.customFields) ? entry.customFields : [],
    savedFields: Array.isArray(entry.savedFields) ? entry.savedFields : [],
    notes: Array.isArray(entry.notes) ? entry.notes : [],
    // Timestamp of the last status change — drives both the "since HH:MM"
    // display and the midnight auto-expiry sweep below. null for devices
    // that predate this field or have always been free.
    since: entry.since || null,
  };
}

export function initDevState(d) {
  devState[d.id] = normalizeDevState(devState[d.id]);
}

export function getDeviceState(devId) {
  if (!devState[devId]) devState[devId] = normalizeDevState();
  return devState[devId];
}

export function setDeviceStatus(devId, status) {
  const entry = getDeviceState(devId);
  entry.status = Object.values(STATUS).includes(status) ? status : STATUS.FREE;
  entry.inUse = entry.status === STATUS.IN_USE;
  if (entry.status !== STATUS.IN_USE) entry.employee = '';
  if (entry.status !== STATUS.NOT_AVAILABLE) entry.notAvailableReason = '';
  return entry;
}

export function getStatusMeta(devId) {
  const entry = getDeviceState(devId);
  if (entry.status === STATUS.IN_USE) {
    return {
      key: STATUS.IN_USE,
      className: 'inuse',
      label: 'In Use',
      shortLabel: 'In Use',
      detail: entry.employee ? `In Use by ${entry.employee}` : '',
    };
  }
  if (entry.status === STATUS.NOT_AVAILABLE) {
    return {
      key: STATUS.NOT_AVAILABLE,
      className: 'notavail',
      label: 'Not Available',
      shortLabel: 'Not Available',
      detail: entry.notAvailableReason ? `Reason: ${entry.notAvailableReason}` : '',
    };
  }
  return { key: STATUS.FREE, className: 'avail', label: 'Free to Use', shortLabel: 'Free', detail: '' };
}

export function getRoomStatusCounts(room) {
  return room.devices.filter(d => d.type !== 'bed').reduce((acc, device) => {
    const key = getStatusMeta(device.id).key;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { free: 0, inuse: 0, not_available: 0 });
}

export const positions = {};
// boxW/boxH are the actual rendered box size (some device types are drawn
// smaller than dev.w/dev.h for visual padding — see sizeScale in
// deviceHTML). Clamping must match whatever size is on screen, or a
// position that's valid at drag time gets snapped back on the next
// render (dragging a bed to the true bottom, then watching it jump back
// up once state syncs).
export function pos(dev, boxW, boxH) {
  const p = positions[dev.id] || { x: dev.x, y: dev.y };
  const w = boxW ?? (dev.w || 10);
  const h = boxH ?? (dev.h || 10);
  p.x = Math.max(0, Math.min(100 - w, p.x));
  p.y = Math.max(0, Math.min(100 - h, p.y));
  return p;
}

const STORAGE_KEY = 'hrm_v9_state_v1';
// currentFloorId/searchFilters are per-browser navigation/UI state, not team
// data — kept in their own localStorage key and never sent to Firebase, so
// one person's floor tab or search box can't jump everyone else's view (see
// "Known sharp edges" in ARCHITECTURE.md).
const LOCAL_UI_KEY = 'hrm_v9_local_ui_v1';
const stateRef = ref(db, 'state');
let applyingRemote = false; // guard so our own writes don't re-apply through the listener

function buildStatePayload() {
  return {
    floors: JSON.parse(JSON.stringify(floors)),
    rooms: JSON.parse(JSON.stringify(rooms)),
    devState: JSON.parse(JSON.stringify(devState)),
    positions: JSON.parse(JSON.stringify(positions)),
    uidCounter: state.uidCounter,
  };
}

function buildDefaultStatePayload() {
  return {
    floors: JSON.parse(JSON.stringify(DEFAULT_FLOORS)),
    rooms: JSON.parse(JSON.stringify(DEFAULT_ROOMS)),
    devState: {},
    positions: {},
    uidCounter: 1000,
  };
}

export function saveState() {
  if (applyingRemote) return; // change came from the server, don't echo it back
  try {
    const payload = buildStatePayload();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    set(stateRef, payload).catch(e => console.warn('Failed to sync state to Firebase', e));
  } catch (e) {
    console.warn('Failed to save state', e);
  }
}

/** Narrow, path-scoped save for a single device's status/employee/reason/
 *  notes/custom fields. Only touches that device's own subtree, so two
 *  people changing different devices at once can't clobber each other the
 *  way a whole-tree saveState() can. */
export function saveDeviceState(devId) {
  if (!devId) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildStatePayload()));
  } catch (e) { /* ignore */ }
  if (applyingRemote) return;
  try {
    set(ref(db, `state/devState/${devId}`), JSON.parse(JSON.stringify(getDeviceState(devId))))
      .catch(e => console.warn('Failed to sync device state to Firebase', e));
  } catch (e) {
    console.warn('Failed to save device state', e);
  }
}

/** Narrow, path-scoped save for a single device's drag position — see
 *  saveDeviceState() above for why this is scoped instead of whole-tree. */
export function saveDevicePosition(devId) {
  if (!devId) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildStatePayload()));
  } catch (e) { /* ignore */ }
  if (applyingRemote) return;
  const p = positions[devId];
  if (!p) return;
  try {
    set(ref(db, `state/positions/${devId}`), p).catch(e => console.warn('Failed to sync position to Firebase', e));
  } catch (e) {
    console.warn('Failed to save position', e);
  }
}

/** Persists per-browser UI state (floor tab, search filters) — localStorage
 *  only, deliberately never synced to Firebase. */
export function saveLocalUIState() {
  try {
    localStorage.setItem(LOCAL_UI_KEY, JSON.stringify({
      currentFloorId: state.currentFloorId,
      searchFilters: state.searchFilters,
    }));
  } catch (e) { /* ignore */ }
}

function loadLocalUIState() {
  try {
    const raw = localStorage.getItem(LOCAL_UI_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.currentFloorId) state.currentFloorId = saved.currentFloorId;
    if (saved.searchFilters) {
      state.searchFilters = {
        floorId: saved.searchFilters.floorId || 'all',
        room: saved.searchFilters.room || '',
        type: saved.searchFilters.type || 'all',
        status: saved.searchFilters.status || 'all',
      };
    }
  } catch (e) { /* ignore */ }
}

function applyStatePayload(p, { resetNav = false } = {}) {
  if (!p) return;
  if (p.floors) {
    floors.length = 0;
    p.floors.forEach(f => floors.push(f));
  }
  if (p.rooms) {
    rooms.length = 0;
    // Firebase RTDB silently drops empty arrays/objects on write (a
    // documented quirk — an empty [] is indistinguishable from "absent"),
    // so a room with zero devices or notes comes back without those keys.
    p.rooms.forEach(r => rooms.push({
      ...r,
      devices: Array.isArray(r.devices) ? r.devices : [],
      notes: Array.isArray(r.notes) ? r.notes : [],
    }));
  } else {
    rooms.forEach(r => {
      if (!Array.isArray(r.devices)) r.devices = [];
      if (!Array.isArray(r.notes)) r.notes = [];
    });
  }
  if (p.devState) {
    Object.keys(devState).forEach(k => delete devState[k]);
    Object.entries(p.devState).forEach(([id, entry]) => {
      devState[id] = normalizeDevState(entry);
    });
  }
  if (p.positions) {
    Object.keys(positions).forEach(k => delete positions[k]);
    Object.assign(positions, p.positions);
  }
  if (resetNav) {
    // Fresh page load — don't resume a room/edit view from a past session.
    state.currentRoom = null;
    state.editingRoomId = null;
    state.editingFloorId = null;
  } else if (state.currentRoom) {
    // Live update while viewing a room — re-point at the fresh copy of
    // that same room (so device changes show up) instead of dropping
    // back to the corridor, unless the room itself was just deleted.
    state.currentRoom = rooms.find(r => r.id === state.currentRoom.id) || null;
  }
  if (p.uidCounter) state.uidCounter = p.uidCounter;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyStatePayload(JSON.parse(raw), { resetNav: true });
  } catch (e) {
    console.warn('Failed to load local state cache', e);
  }
  loadLocalUIState();
}

/** Fetches the shared state from Firebase once; seeds Firebase with the
 *  pristine default layout if nothing has been saved there yet (first run
 *  for the team). */
export async function loadRemoteState() {
  try {
    const snap = await get(stateRef);
    if (snap.exists()) {
      applyingRemote = true;
      applyStatePayload(snap.val(), { resetNav: true });
      applyingRemote = false;
    } else {
      const defaults = buildDefaultStatePayload();
      await set(stateRef, defaults);
      applyingRemote = true;
      applyStatePayload(defaults, { resetNav: true });
      applyingRemote = false;
    }
  } catch (e) {
    console.warn('Failed to load state from Firebase, using local cache', e);
  }
}

/** Subscribes to live updates from teammates; calls onChange() after
 *  applying each remote update so the caller can re-render. */
export function subscribeRemoteState(onChange) {
  return onValue(stateRef, snap => {
    if (!snap.exists()) return;
    applyingRemote = true;
    applyStatePayload(snap.val());
    applyingRemote = false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap.val()));
    onChange();
  }, e => console.warn('Lost live sync with Firebase', e));
}

export function getAllSNs() {
  const sns = new Set();
  rooms.forEach(r => r.devices.forEach(d => {
    if (d.sn) sns.add(d.sn.trim().toUpperCase());
  }));
  return sns;
}

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const typeLabel = {
  tv: 'TV',
  hello: 'HELLO',
  whiteboard: 'WHITEBOARD',
  bed: 'BED',
  roomsign: 'ROOM SIGN',
};

export const typeDefaults = {
  hello: { w: 9, h: 6 },
  tv: { w: 28, h: 22.5 },
  whiteboard: { w: 11.5, h: 25 },
  roomsign: { w: 6, h: 8 },
  bed: { w: 20, h: 52 },
};

export function devSummary(room) {
  const counts = {};
  room.devices.forEach(d => {
    counts[d.type] = (counts[d.type] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([type, count]) => count + '× ' + typeLabel[type])
    .join(' · ');
}

export function roomHasInUse(room) {
  return room.devices.some(d => getStatusMeta(d.id).key === STATUS.IN_USE || getStatusMeta(d.id).key === STATUS.NOT_AVAILABLE);
}

export function roomHasSign(room) {
  return room.devices.some(d => d.type === 'roomsign');
}

export function bedSVG() {
  return `<svg class="bed-shape" viewBox="0 0 60 130" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
    <rect x="2" y="2" width="56" height="126" rx="6" fill="none" stroke="#9090aa" stroke-width="2.5"/>
    <rect x="2"  y="2"  width="56" height="12" rx="5" fill="#9090aa" stroke="#7878a0" stroke-width="1.5"/>
    <rect x="5"  y="2"  width="6" height="6" rx="2" fill="#686890"/>
    <rect x="49" y="2"  width="6" height="6" rx="2" fill="#686890"/>
    <rect x="5"  y="14" width="50" height="98" rx="2" fill="#d0d0e4"/>
    <rect x="5"  y="14" width="50" height="70" rx="1" fill="#b8b8d4"/>
    <polygon points="5,14 32,14 5,34" fill="#aaaac8"/>
    <line x1="5" y1="14" x2="55" y2="14" stroke="#9090b0" stroke-width="1.5"/>
    <rect x="13" y="90" width="34" height="20" rx="5" fill="#c8c8e0" stroke="#9090b0" stroke-width="1"/>
    <rect x="2"  y="112" width="56" height="16" rx="5" fill="#9090aa" stroke="#7878a0" stroke-width="1.5"/>
    <rect x="5"  y="124" width="6" height="4" rx="2" fill="#686890"/>
    <rect x="49" y="124" width="6" height="4" rx="2" fill="#686890"/>
  </svg>`;
}

export function initState() {
  loadState();
  rooms.forEach(room => {
    if (!Array.isArray(room.notes)) room.notes = [];
    room.devices.forEach(initDevState);
  });
}

// ── device status auto-expiry ────────────────────────────────────────
// A device left "In Use" or "Not Available" reverts to Free at the next
// midnight (browser-local time) — otherwise a status set one day just sits
// there forever into the next. Same cooperative, no-backend cleanup pattern
// as the notification pruning below: whichever client is open sweeps on
// load and every 30 minutes; worst case it's caught within 30 min of
// midnight rather than the instant the clock ticks over.
const DEVICE_STATUS_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
let _deviceExpiryTimer = null;

function sweepExpiredDeviceStatuses() {
  const todayKey = new Date().toDateString();
  let changed = false;
  Object.entries(devState).forEach(([devId, entry]) => {
    if (entry.status === STATUS.FREE) return;
    if (!entry.since) {
      // Pre-existing data from before this field existed — start the
      // clock now rather than assuming it's already overdue.
      entry.since = Date.now();
      saveDeviceState(devId);
      changed = true;
      return;
    }
    if (new Date(entry.since).toDateString() !== todayKey) {
      entry.status = STATUS.FREE;
      entry.inUse = false;
      entry.employee = '';
      entry.notAvailableReason = '';
      entry.since = Date.now();
      saveDeviceState(devId);
      changed = true;
    }
  });
  return changed;
}

/** Starts the periodic sweep; onChange() fires whenever a device actually
 *  got auto-freed, so the caller can re-render. Call once after signing
 *  in (mirrors startLiveSync's other subscriptions). */
export function startDeviceStatusExpiry(onChange) {
  if (sweepExpiredDeviceStatuses() && onChange) onChange();
  if (_deviceExpiryTimer) return () => {};
  _deviceExpiryTimer = setInterval(() => {
    if (sweepExpiredDeviceStatuses() && onChange) onChange();
  }, DEVICE_STATUS_SWEEP_INTERVAL_MS);
  return () => {
    if (_deviceExpiryTimer) { clearInterval(_deviceExpiryTimer); _deviceExpiryTimer = null; }
  };
}

// ── teammate activity notifications ─────────────────────────────────
// Entries live for 12 hours (for the notification-bell history), then
// get pruned. Cleanup is cooperative and client-side (no backend): every
// client that subscribes prunes expired entries once, plus a periodic
// sweep while the app stays open — no entry can survive past ~12h once
// at least one teammate has the app open since then.
const notificationsRef = ref(db, 'notifications');
const NOTIFICATION_TTL_MS = 12 * 60 * 60 * 1000;
const NOTIFICATION_PRUNE_INTERVAL_MS = 30 * 60 * 1000;

let _notifications = []; // newest first
const _knownNotificationIds = new Set();
const NOTIF_SEEN_KEY = 'hrm_notif_last_seen_v1';

export function getUnreadNotificationCount() {
  const lastSeen = Number(localStorage.getItem(NOTIF_SEEN_KEY) || 0);
  const myId = getAuthSession()?.id;
  return _notifications.filter(n => n.ts > lastSeen && n.by !== myId).length;
}

export function markNotificationsSeen() {
  localStorage.setItem(NOTIF_SEEN_KEY, String(Date.now()));
}

function pruneStaleNotifications(snapshotVal) {
  const cutoff = Date.now() - NOTIFICATION_TTL_MS;
  Object.entries(snapshotVal || {}).forEach(([key, entry]) => {
    if (!entry || (entry.ts || 0) < cutoff) {
      remove(ref(db, `notifications/${key}`)).catch(() => {});
    }
  });
}

export function broadcastActivity(message) {
  const session = getAuthSession();
  set(push(notificationsRef), {
    message, by: session?.id || '', byUsername: session?.username || '', ts: Date.now(),
  }).catch(e => console.warn('Failed to post notification', e));
}

export function getNotifications() {
  return _notifications;
}

/** onListChange() fires whenever the notification history changes (for
 *  the bell dropdown). onNewNotification(entry) fires only for genuinely
 *  new entries from someone else (for the live toast popup). */
export async function subscribeNotifications(onListChange, onNewNotification) {
  const session = getAuthSession();
  const cutoff = Date.now() - NOTIFICATION_TTL_MS;

  const snap = await get(notificationsRef);
  const val = snap.val() || {};
  pruneStaleNotifications(val);
  _notifications = Object.entries(val)
    .map(([id, entry]) => ({ id, ...entry }))
    .filter(n => (n.ts || 0) >= cutoff)
    .sort((a, b) => b.ts - a.ts);
  _notifications.forEach(n => _knownNotificationIds.add(n.id));
  onListChange();

  const unsubAdd = onChildAdded(notificationsRef, s => {
    if (_knownNotificationIds.has(s.key)) return; // part of the initial load above
    _knownNotificationIds.add(s.key);
    const entry = s.val();
    if (!entry || (entry.ts || 0) < cutoff) return;
    _notifications = [{ id: s.key, ...entry }, ..._notifications];
    onListChange();
    if (entry.by !== session?.id) onNewNotification(entry);
  }, e => console.warn('Failed to subscribe to notifications', e));

  const unsubRemove = onChildRemoved(notificationsRef, s => {
    _knownNotificationIds.delete(s.key);
    _notifications = _notifications.filter(n => n.id !== s.key);
    onListChange();
  });

  const pruneTimer = setInterval(() => {
    get(notificationsRef).then(sn => pruneStaleNotifications(sn.val() || {})).catch(() => {});
  }, NOTIFICATION_PRUNE_INTERVAL_MS);

  return () => {
    unsubAdd();
    unsubRemove();
    clearInterval(pruneTimer);
    _notifications = [];
    _knownNotificationIds.clear();
  };
}
