(() => {
  // hospital_room_monitor_v9.auth.js — Auth module
// ─────────────────────────────────────────────────────────────────
//  Auth — user store (localStorage) + session (sessionStorage)
//  Passwords are SHA-256 hashed; never stored in plain text.
// ─────────────────────────────────────────────────────────────────

const AUTH_KEY    = 'hrm_auth_v2';
const SESSION_KEY = 'hrm_sess_v2';

let _data    = { users: [] }; // persists across sessions
let _session = null;          // { id, username, role } — cleared on tab close

// ── persistence ───────────────────────────────────────────────────

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _data = { users: Array.isArray(parsed.users) ? parsed.users : [] };
    }
  } catch (e) { _data = { users: [] }; }

  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (s) _session = JSON.parse(s);
  } catch (e) { _session = null; }
}

function _save() {
  localStorage.setItem(AUTH_KEY, JSON.stringify(_data));
}

// ── crypto ────────────────────────────────────────────────────────

async function _hash(pw) {
  const buf  = new TextEncoder().encode(pw);
  const dig  = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(dig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function _uid() {
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── queries ───────────────────────────────────────────────────────

function isFirstRun()     { return _data.users.length === 0; }
function isLoggedIn()     { return !!_session; }
function getAuthSession() { return _session; }
function isAdminSession() { return _session?.role === 'admin'; }

/** Returns safe copies — no passwordHash exposed */
function getAuthUsers() {
  return _data.users.map(u => ({
    id: u.id, username: u.username, role: u.role, createdAt: u.createdAt,
  }));
}

// ── login / logout ────────────────────────────────────────────────

async function login(username, password) {
  const hash = await _hash(password);
  const user = _data.users.find(
    u => u.username.toLowerCase() === (username || '').trim().toLowerCase()
      && u.passwordHash === hash,
  );
  if (!user) return { ok: false, error: 'Invalid username or password.' };
  _session = { id: user.id, username: user.username, role: user.role };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(_session));
  return { ok: true };
}

function logout() {
  _session = null;
  sessionStorage.removeItem(SESSION_KEY);
}

// ── user management (admin-only operations) ───────────────────────

async function createUser(username, password, role) {
  const name = (username || '').trim();
  if (!name)            return { ok: false, error: 'Username is required.' };
  if (name.length < 2)  return { ok: false, error: 'Username must be at least 2 characters.' };
  if (name.length > 40) return { ok: false, error: 'Username must be 40 characters or less.' };
  if (!password || password.length < 4)
    return { ok: false, error: 'Password must be at least 4 characters.' };
  if (!['admin', 'user'].includes(role))
    return { ok: false, error: 'Role must be admin or user.' };
  if (_data.users.some(u => u.username.toLowerCase() === name.toLowerCase()))
    return { ok: false, error: 'That username is already taken.' };

  const hash = await _hash(password);
  const user = {
    id: _uid(),
    username: name,
    passwordHash: hash,
    role,
    createdAt: new Date().toISOString(),
  };
  _data.users.push(user);
  _save();
  return { ok: true, user };
}

function removeUser(userId) {
  const user = _data.users.find(u => u.id === userId);
  if (!user) return { ok: false, error: 'User not found.' };
  if (_session && _session.id === userId)
    return { ok: false, error: 'You cannot delete your own account.' };
  if (user.role === 'admin') {
    const adminCount = _data.users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1)
      return { ok: false, error: 'Cannot delete the last admin account.' };
  }
  _data.users = _data.users.filter(u => u.id !== userId);
  _save();
  return { ok: true };
}

function setUserRole(userId, newRole) {
  if (!['admin', 'user'].includes(newRole))
    return { ok: false, error: 'Invalid role.' };
  const user = _data.users.find(u => u.id === userId);
  if (!user) return { ok: false, error: 'User not found.' };
  if (user.role === 'admin' && newRole !== 'admin') {
    const adminCount = _data.users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1)
      return { ok: false, error: 'Cannot demote the only admin.' };
  }
  user.role = newRole;
  _save();
  // Keep session in sync if the user changed their own role
  if (_session && _session.id === userId) {
    _session.role = newRole;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(_session));
  }
  return { ok: true };
}

async function changeUserPassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 4)
    return { ok: false, error: 'Password must be at least 4 characters.' };
  const user = _data.users.find(u => u.id === userId);
  if (!user) return { ok: false, error: 'User not found.' };
  user.passwordHash = await _hash(newPassword);
  _save();
  return { ok: true };
}

  // hospital_room_monitor_v9.data.js — Data / state
const debugStore = DEBUG_HRM ? (window.HRM = window.HRM || {}) : {};
if (!DEBUG_HRM && typeof window !== 'undefined' && window.HRM) {
  try { delete window.HRM; } catch (e) { window.HRM = undefined; }
}

const STATUS = {
  FREE: 'free',
  IN_USE: 'inuse',
  NOT_AVAILABLE: 'not_available',
};

const state = debugStore.state = {
  currentRole: 'admin',
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

function isAdmin() {
  return isAdminSession();
}

function canEditStructure() {
  return isAdmin();
}

function canUpdateStatus() {
  return isLoggedIn(); // both admin and user can update device status
}

function canAddNotes() {
  return isLoggedIn(); // both admin and user can add notes
}

function toggleRoleState() {
  // no-op — roles are managed through real user accounts now
}

function uid(prefix = 'dev') {
  return prefix + (++state.uidCounter);
}

function noteUid() {
  return 'note' + (++state.uidCounter);
}

const floors = debugStore.floors = [
  { id:'f1', name:'Floor 1 - Corridor A' },
  { id:'f2', name:'Floor 2 - Corridor B' },
];

const rooms = debugStore.rooms = [
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

const devState = debugStore.devState = {};

function normalizeDevState(entry = {}) {
  const status = entry.status || (entry.inUse ? STATUS.IN_USE : STATUS.FREE);
  return {
    status: Object.values(STATUS).includes(status) ? status : STATUS.FREE,
    inUse: status === STATUS.IN_USE,
    employee: entry.employee || '',
    notAvailableReason: entry.notAvailableReason || entry.reason || '',
    customFields: Array.isArray(entry.customFields) ? entry.customFields : [],
    savedFields: Array.isArray(entry.savedFields) ? entry.savedFields : [],
    notes: Array.isArray(entry.notes) ? entry.notes : [],
  };
}

function initDevState(d) {
  devState[d.id] = normalizeDevState(devState[d.id]);
}

function getDeviceState(devId) {
  if (!devState[devId]) devState[devId] = normalizeDevState();
  return devState[devId];
}

function setDeviceStatus(devId, status) {
  const entry = getDeviceState(devId);
  entry.status = Object.values(STATUS).includes(status) ? status : STATUS.FREE;
  entry.inUse = entry.status === STATUS.IN_USE;
  if (entry.status !== STATUS.IN_USE) entry.employee = '';
  if (entry.status !== STATUS.NOT_AVAILABLE) entry.notAvailableReason = '';
  return entry;
}

function getStatusMeta(devId) {
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

function getRoomStatusCounts(room) {
  return room.devices.filter(d => d.type !== 'bed').reduce((acc, device) => {
    const key = getStatusMeta(device.id).key;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { free: 0, inuse: 0, not_available: 0 });
}

const positions = debugStore.positions = {};
function pos(dev) {
  // Return fresh copy — never mutate stored position (prevents bed drift bug)
  const src = positions[dev.id];
  if (src) return { x: src.x, y: src.y };
  return { x: dev.x, y: dev.y };
}

const STORAGE_KEY = 'hrm_v9_state_v1';

function saveState() {
  try {
    const payload = {
      floors: JSON.parse(JSON.stringify(floors)),
      rooms: JSON.parse(JSON.stringify(rooms)),
      devState: JSON.parse(JSON.stringify(devState)),
      positions: JSON.parse(JSON.stringify(positions)),
      state: {
        currentRole: state.currentRole,
        currentFloorId: state.currentFloorId,
        uidCounter: state.uidCounter,
        searchFilters: JSON.parse(JSON.stringify(state.searchFilters)),
      },
      uidCounter: state.uidCounter,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Failed to save state', e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.floors) {
      floors.length = 0;
      p.floors.forEach(f => floors.push(f));
    }
    if (p.rooms) {
      rooms.length = 0;
      p.rooms.forEach(r => rooms.push({ ...r, notes: Array.isArray(r.notes) ? r.notes : [] }));
    } else {
      rooms.forEach(r => { if (!Array.isArray(r.notes)) r.notes = []; });
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
    if (p.state) {
      Object.assign(state, p.state);
      state.currentRoom = null;
      state.editingRoomId = null;
      state.editingFloorId = null;
      state.searchFilters = {
        floorId: state.searchFilters?.floorId || 'all',
        room: state.searchFilters?.room || '',
        type: state.searchFilters?.type || 'all',
        status: state.searchFilters?.status || 'all',
      };
    }
    if (p.uidCounter) state.uidCounter = p.uidCounter;
  } catch (e) {
    console.warn('Failed to load state', e);
  }
}

function getAllSNs() {
  const sns = new Set();
  rooms.forEach(r => r.devices.forEach(d => {
    if (d.sn) sns.add(d.sn.trim().toUpperCase());
  }));
  return sns;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const typeLabel = {
  tv: 'TV',
  hello: 'HELLO',
  whiteboard: 'WHITEBOARD',
  bed: 'BED',
  roomsign: 'ROOM SIGN',
};

const typeDefaults = {
  hello: { w: 9, h: 6 },
  tv: { w: 28, h: 22.5 },
  whiteboard: { w: 11.5, h: 25 },
  roomsign: { w: 6, h: 8 },
  bed: { w: 20, h: 52 },
};

function devSummary(room) {
  const counts = {};
  room.devices.forEach(d => {
    counts[d.type] = (counts[d.type] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([type, count]) => count + '× ' + typeLabel[type])
    .join(' · ');
}

function roomHasInUse(room) {
  return room.devices.some(d => getStatusMeta(d.id).key === STATUS.IN_USE || getStatusMeta(d.id).key === STATUS.NOT_AVAILABLE);
}

function roomHasSign(room) {
  return room.devices.some(d => d.type === 'roomsign');
}

function bedSVG() {
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

function initState() {
  loadState();
  rooms.forEach(room => {
    if (!Array.isArray(room.notes)) room.notes = [];
    room.devices.forEach(initDevState);
  });
}

if (DEBUG_HRM) {
  Object.assign(debugStore, {
    state,
    floors,
    rooms,
    devState,
    positions,
    isAdmin,
    toggleRoleState,
    uid,
  });
}

  // hospital_room_monitor_v9.render.js — Render
function formatNoteDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(value));
  } catch (e) {
    return value;
  }
}

function noteRows(notes = [], targetType, targetId, roomId = '') {
  if (!notes.length) return '<div class="note-empty">No notes yet.</div>';
  return `<div class="note-list">${notes.map(note => `
    <div class="note-item">
      <div class="note-body">
        <div class="note-text">${esc(note.text || '')}</div>
        <div class="note-meta">${esc(note.author || 'Employee')} · ${esc(formatNoteDate(note.createdAt))}</div>
      </div>
      ${isAdmin() ? `<button class="note-del" data-action="delete-note" data-note-target="${targetType}" data-target-id="${targetId}" data-room="${roomId}" data-note-id="${note.id}" title="Delete note">×</button>` : ''}
    </div>`).join('')}</div>`;
}

function statusBadgeHTML(meta) {
  return `<div class="status-badge ${meta.className}"><div class="sbdot"></div>${esc(meta.label)}</div>`;
}

const dirtyPanels = new Set();

function markPanelDirty(devId) {
  if (!devId) return;
  dirtyPanels.add(devId);
  const bar = document.getElementById(`panelSaveBar_${devId}`);
  if (bar) {
    bar.hidden = false;
    bar.classList.add('dirty');
  }
}

function clearPanelDirty(devId) {
  if (!devId) return;
  dirtyPanels.delete(devId);
  const bar = document.getElementById(`panelSaveBar_${devId}`);
  if (bar) {
    bar.hidden = true;
    bar.classList.remove('dirty');
  }
}

function deviceHTML(dev, room) {
  // Compute display dims first to clamp pos with matching bounds (matches drag)
  const sizeScale = {
    bed: { w: 0.84, h: 0.84 },
    tv: { w: 0.82, h: 0.90 },
    whiteboard: { w: 0.92, h: 0.92 },
    hello: { w: 0.80, h: 0.80 },
  }[dev.type] || { w: 1, h: 1 };
  const displayW = Math.max(1, Number(((dev.w || 10) * sizeScale.w).toFixed(2)));
  const displayH = Math.max(1, Number(((dev.h || 10) * sizeScale.h).toFixed(2)));
  const p = pos(dev);
  p.x = Math.max(0, Math.min(100 - displayW, p.x));
  p.y = Math.max(0, Math.min(100 - displayH, p.y));
  const st = getDeviceState(dev.id);
  const meta = getStatusMeta(dev.id);
  let inner = '';
  const deletable = isAdmin();

  if (dev.type === 'tv') {
    const ledCls = meta.key === STATUS.FREE ? ' avail' : (meta.key === STATUS.NOT_AVAILABLE ? ' notavail' : ' inuse');
    inner = `<div class="tv-outer">
      <div class="tv-screen">
        <div class="tv-noise"></div>
        <div class="tv-scan"></div>
        <span class="tv-label-text">${esc(dev.label)}</span>
        <span class="tv-sn-badge">${esc(dev.sn || '')}</span>
      </div>
      <div class="tv-stand-bar"></div>
      <div class="tv-stand-base"></div>
      <div class="tv-led${ledCls}"></div>
    </div>`;
  } else if (dev.type === 'hello') {
    const cls = meta.key === STATUS.FREE ? ' available' : ' in-use';
    inner = `<div class="hello-shape${cls}">
      <div class="hello-body-bar"></div>
      <div class="hello-center-disc">
        <div class="hello-center-core"></div>
      </div>
    </div>`;
  } else if (dev.type === 'whiteboard') {
    const ledCls = meta.key === STATUS.FREE ? ' avail' : (meta.key === STATUS.NOT_AVAILABLE ? ' notavail' : ' inuse');
    inner = `<div class="wb-shape">
      <div class="wb-panel">
        <div class="wb-screen-area">
          <div class="wb-screen-lines">
            <div class="wb-screen-line"></div>
            <div class="wb-screen-line s"></div>
            <div class="wb-screen-line"></div>
            <div class="wb-screen-line s"></div>
          </div>
        </div>
        <div class="wb-side-rail"></div>
      </div>
      <div class="wb-led${ledCls}"></div>
    </div>`;
  } else if (dev.type === 'roomsign') {
    const barCls = meta.key === STATUS.FREE ? ' avail' : (meta.key === STATUS.NOT_AVAILABLE ? ' notavail' : ' inuse');
    inner = `<div class="rsign-shape">
      <div class="rsign-bezel">
        <div class="rsign-screen">
          <div class="rsign-room-pill"></div>
          <div class="rsign-text-lines">
            <div class="rsign-line"></div>
            <div class="rsign-line s"></div>
            <div class="rsign-line"></div>
          </div>
        </div>
        <div class="rsign-status-bar${barCls}"></div>
      </div>
    </div>`;
  } else if (dev.type === 'bed') {
    inner = bedSVG();
  }

  const delBtn = deletable
    ? `<div class="dev-actions admin-only"><button class="dev-del-btn" data-action="delete-device" data-device-id="${dev.id}" data-room="${room.id}" title="Remove device">×</button></div>`
    : '';

  const draggable = isAdmin();

  const aria = `${esc(dev.label)} · ${typeLabel[dev.type]} · ${meta.label}`;
  return `<div class="device" id="dev-${dev.id}"
    style="left:${p.x}%;top:${p.y}%;width:${displayW}%;height:${displayH}%;"
    data-device-id="${dev.id}" data-room="${room.id}" data-type="${dev.type}" data-status="${meta.key}" data-w="${displayW}" data-h="${displayH}"
    data-draggable="${draggable}" tabindex="0" role="button" aria-label="${esc(aria)}">
    ${delBtn}
    <div class="viewer-lock"></div>
    ${inner}
  </div>`;
}

function renderHeader() {
  const floorRooms = rooms.filter(r => r.floorId === state.currentFloorId);
  const tot = rooms.reduce((sum, room) => sum + room.devices.length, 0);
  const session = getAuthSession();
  const isAdm = isAdminSession();
  const roleChip = session
    ? `<span class="hdr-role-chip ${session.role === 'admin' ? 'admin' : 'user'}">${session.role === 'admin' ? 'Admin' : 'User'}</span>`
    : '';

  return `<div class="hdr">
    <div class="hdr-left">
      <div class="hdr-mark"></div>
      <div class="hdr-title">HELLOCARE ROOM MONITOR</div>
    </div>
    <div class="hdr-right">
      <div class="hdr-search-wrap">
        <div class="hdr-search">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="white" stroke-width="1.6"/><path d="M9.5 9.5L13 13" stroke="white" stroke-width="1.6" stroke-linecap="round"/></svg>
          <input type="text" placeholder="Search SN, device, room, note..." id="snSearchInput" />
        </div>
      </div>
      <div class="hdr-pill">${floorRooms.length} ROOMS</div>
      <div class="hdr-pill">${tot} DEVICES</div>
      ${session ? `
        <div class="hdr-user-info">
          <span class="hdr-username">${esc(session.username)}</span>
          ${roleChip}
        </div>
        ${isAdm ? `<button class="hdr-action-btn" data-action="open-user-mgmt" type="button">Users</button>` : ''}
        <button class="hdr-action-btn signout" data-action="do-logout" type="button">Sign Out</button>
      ` : ''}
    </div>
  </div>`;
}

function handleSearch(value) {
  const q = value.trim().toLowerCase();
  const sr = document.getElementById('searchResults');
  const list = document.getElementById('srList');
  const active = document.getElementById('srActiveFilters');
  const floorFilter = document.getElementById('filterFloor');
  const roomFilter = document.getElementById('filterRoom');
  const typeFilter = document.getElementById('filterType');
  const statusFilter = document.getElementById('filterStatus');

  if (!sr || !list) return;

  const floorId = floorFilter ? floorFilter.value : 'all';
  const roomName = roomFilter ? roomFilter.value.trim().toLowerCase() : '';
  const type = typeFilter ? typeFilter.value : 'all';
  const status = statusFilter ? statusFilter.value : 'all';
  const hasFilters = Boolean(q || roomName || type !== 'all' || status !== 'all' || floorId !== 'all');

  if (!hasFilters) {
    sr.classList.remove('open');
    list.innerHTML = '';
    if (active) active.innerHTML = '';
    return;
  }

  sr.classList.add('open');
  const chips = [];
  if (q) chips.push(`Search: ${value.trim()}`);
  if (floorId !== 'all') chips.push(`Floor: ${floors.find(f => f.id === floorId)?.name || floorId}`);
  if (roomName) chips.push(`Room: ${roomFilter.value.trim()}`);
  if (type !== 'all') chips.push(`Type: ${typeLabel[type] || type}`);
  if (status !== 'all') chips.push(`Status: ${status === STATUS.FREE ? 'Free to Use' : status === STATUS.IN_USE ? 'In Use' : 'Not Available'}`);
  if (active) active.innerHTML = chips.map(chip => `<span class="sr-chip">${esc(chip)}</span>`).join('');

  const results = [];

  rooms.forEach(room => {
    const floor = floors.find(floor => floor.id === room.floorId);
    if (floorId !== 'all' && room.floorId !== floorId) return;
    if (roomName && !room.name.toLowerCase().includes(roomName)) return;

    room.devices.forEach(device => {
      if (type !== 'all' && device.type !== type) return;
      const st = getDeviceState(device.id);
      const meta = getStatusMeta(device.id);
      if (status !== 'all' && meta.key !== status) return;

      const noteText = (st.notes || []).map(note => note.text || '').join(' ');
      const haystack = [
        device.sn,
        device.label,
        typeLabel[device.type],
        room.name,
        floor?.name,
        meta.label,
        st.employee,
        st.notAvailableReason,
        noteText,
      ].filter(Boolean).join(' ').toLowerCase();

      if (q && !haystack.includes(q)) return;
      results.push({ device, room, floor, meta });
    });
  });

  if (!results.length) {
    const details = chips.length ? chips.join(' · ') : value;
    list.innerHTML = `<span class="sr-empty">No devices found for ${esc(details || 'the selected filters')}.</span>`;
    return;
  }

  list.innerHTML = `<div class="sr-count">${results.length} result${results.length === 1 ? '' : 's'}</div>` + results.map(({ device, room, floor, meta }) => {
    return `<div class="sr-item" data-action="goto-device" data-device-id="${device.id}" data-room="${room.id}">
      <span class="sr-sn">${esc(device.sn || device.label)}</span>
      <span class="sr-meta">${esc(device.label)} · ${esc(room.name)} · ${floor ? esc(floor.name) : ''} · ${typeLabel[device.type]}</span>
      <span class="sr-status ${meta.className}">${esc(meta.label)}</span>
    </div>`;
  }).join('');
}

function clearSearch() {
  const sr = document.getElementById('searchResults');
  const input = document.getElementById('snSearchInput');
  if (sr) sr.classList.remove('open');
  if (input) input.value = '';
}

function goToDevice(devId, roomId) {
  clearSearch();
  const room = rooms.find(room => room.id === roomId);
  if (!room) return;
  state.currentFloorId = room.floorId;
  state.currentRoom = room;
  render();
  setTimeout(initDrag, 40);
  if (room.devices.some(device => device.id === devId && device.type !== 'bed')) {
    openPanel(devId, roomId);
  }
}

function switchFloor(floorId) {
  state.currentFloorId = floorId;
  state.currentRoom = null;
  render();
}

function renderCorridor() {
  const currentFloor = floors.find(floor => floor.id === state.currentFloorId) || floors[0];
  const floorRooms = rooms.filter(room => room.floorId === state.currentFloorId);
  const leftRooms = floorRooms.filter(room => room.side === 'left').sort((a, b) => a.pos - b.pos);
  const rightRooms = floorRooms.filter(room => room.side === 'right').sort((a, b) => a.pos - b.pos);
  const rowCount = Math.max(leftRooms.length, rightRooms.length, 1);

  const floorTabs = floors.map(floor => `
    <button class="floor-tab${floor.id === state.currentFloorId ? ' active' : ''}" data-action="switch-floor" data-floor="${floor.id}">${esc(floor.name)}</button>
  `).join('');

  let rows = '';

  for (let index = 0; index < rowCount; index++) {
    const leftRoom = leftRooms[index];
    const rightRoom = rightRooms[index];

    const renderCell = room => {
      if (!room) {
        return `<div class="empty-cell"><span>Drop room here</span></div>`;
      }
      const hasInUse = roomHasInUse(room);
      const counts = getRoomStatusCounts(room);
      const statusSummary = `<div class="rstatus-summary">
        <span class="rstatus-pill avail">${counts.free || 0} Free</span>
        <span class="rstatus-pill inuse">${counts.inuse || 0} In Use</span>
        ${counts.not_available ? `<span class="rstatus-pill notavail">${counts.not_available} Not Available</span>` : ''}
      </div>`;

      return `<button class="room-btn${hasInUse ? ' has-inuse' : ''}" data-action="open-room" data-room="${room.id}" draggable="${isAdmin() ? 'true' : 'false'}" data-room-draggable="${isAdmin() ? 'true' : 'false'}">
        <div class="room-btn-top">
          <div class="rname">${esc(room.name)}</div>
        </div>
        <div class="rdevs">${devSummary(room)}</div>
        ${statusSummary}
        <div class="rstatus-dots">${room.devices.filter(device => device.type !== 'bed').map(device => {
          const meta = getStatusMeta(device.id);
          return `<div class="rstatus-dot ${meta.className}" title="${esc(device.label)}: ${esc(meta.label)}"></div>`;
        }).join('')}</div>
      </button>`;
    };

    rows += `<div class="floor-row">
      <div class="room-cell lc"><div class="room-slot" data-room-slot="true" data-floor="${state.currentFloorId}" data-side="left" data-slot-index="${index + 1}" data-room-id="${leftRoom ? leftRoom.id : ''}">${renderCell(leftRoom)}</div></div>
      <div class="corridor-col"><div class="corridor-line"></div></div>
      <div class="room-cell rc"><div class="room-slot" data-room-slot="true" data-floor="${state.currentFloorId}" data-side="right" data-slot-index="${index + 1}" data-room-id="${rightRoom ? rightRoom.id : ''}">${renderCell(rightRoom)}</div></div>
    </div>`;
  }

  const adminActions = isAdmin() ? `<div class="floor-manage-actions">
    <button class="btn-sm ghost" data-action="edit-floor" data-floor="${currentFloor.id}">Edit Floor</button>
    <button class="btn-sm ghost danger" data-action="delete-floor" data-floor="${currentFloor.id}">Delete Floor</button>
    <button class="btn-sm ghost" data-action="add-room">+ Add Room</button>
  </div>` : '';

  return `<div class="corridor-wrap">
    <div class="corridor-top">
      <div class="corridor-label-group">
        <div class="corridor-label">${esc(currentFloor.name)}</div>
        <div class="corridor-sub">${floorRooms.length} rooms · ${floorRooms.reduce((total, room) => total + room.devices.length, 0)} devices</div>
      </div>
      <div class="corridor-actions">
        ${adminActions}
      </div>
    </div>
    <div class="floor-tabs">
      ${floorTabs}
      ${isAdmin() ? `<button class="floor-tab-add admin-only" data-action="add-floor" title="Add floor/corridor">＋</button>` : ''}
    </div>
    <div class="floor-plan">
      <div class="cap"></div>
      ${rows}
      <div class="cap bot"></div>
    </div>
  </div>`;
}

function renderRoom(room) {
  const roomTotals = {};
  room.devices.forEach(device => {
    roomTotals[device.type] = (roomTotals[device.type] || 0) + 1;
  });

  const statsRows = Object.entries(roomTotals).map(([type, count]) =>
    `<div class="srow"><span class="srow-k">${typeLabel[type]}</span><span class="srow-v">${count}</span></div>`
  ).join('');

  const deviceListItems = room.devices.filter(device => device.type !== 'bed').map(device => {
    const meta = getStatusMeta(device.id);
    return `<div class="dev-list-item">
      <div>
        <div class="dev-list-name">${esc(device.label)}</div>
        <div class="dev-list-type">${typeLabel[device.type]} · ${esc(device.sn || '')}</div>
      </div>
      <div class="dev-status-inline" title="${esc(meta.label)}">
        <div class="dev-status-dot ${meta.className}"></div>
        <div class="dev-status-text">${esc(meta.shortLabel)}</div>
      </div>
    </div>`;
  }).join('');

  const bedListItems = room.devices.filter(device => device.type === 'bed').map(device => `
    <div class="bed-list-item">
      <div>
        <div class="dev-list-name">${esc(device.label)}</div>
        <div class="dev-list-type">Bed furniture · ${esc(device.sn || '')}</div>
      </div>
      ${isAdmin() ? `<button class="btn-mini danger admin-only" data-action="delete-device" data-device-id="${device.id}" data-room="${room.id}" title="Delete bed">Delete</button>` : ''}
    </div>
  `).join('');

  const devHTML = room.devices.map(device => deviceHTML(device, room)).join('');
  const floor = floors.find(floor => floor.id === room.floorId);
  const viewNotice = !isAdmin() ? `<div class="view-notice">Employee mode: you can view everything, update device status, and leave notes. Admin mode is needed for layout changes.</div>` : '';

  const adminActions = isAdmin() ? `
    <button class="btn-sm ghost admin-only" data-action="edit-room" data-room="${room.id}">Edit Room</button>
    <button class="btn-sm ghost danger admin-only" data-action="delete-room" data-room="${room.id}">Delete Room</button>
    <button class="btn-sm ghost admin-only" data-action="add-bed" data-room="${room.id}">Add Bed</button>
    <button class="btn-add-device admin-only" data-action="add-device" data-room="${room.id}">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="8" y1="2" x2="8" y2="14" stroke="white" stroke-width="2.5" stroke-linecap="round"/><line x1="2" y1="8" x2="14" y2="8" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>
      Add Device
    </button>
  ` : '';

  return `<div class="breadcrumb">
    <button data-action="go-back">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="${isAdmin() ? '#1a6bff' : '#1a6bff'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${floor ? esc(floor.name) : 'Floor Plan'}
    </button>
    <span style="color:var(--border2)">›</span>
    <span style="color:var(--text2);font-weight:800;">${esc(room.name)}</span>
  </div>
  <div class="room-wrap">
    <div class="room-canvas">
      <div class="room-canvas-hdr">
        <div>
          <div class="room-title-row">
            <div class="room-title">${esc(room.name)}</div>
            ${isAdmin() ? `<button class="edit-name-btn admin-only" data-action="edit-room" data-room="${room.id}" title="Edit room">
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M10 2l3 3-9 9H1v-3l9-9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            </button>` : ''}
          </div>
          <div class="room-sub">${isAdmin() ? 'Drag devices to reposition · Use arrow keys for fine movement · Click for info' : 'Click device to view info'}</div>
        </div>
        <div class="room-canvas-actions">
          ${adminActions}
        </div>
      </div>
      ${viewNotice}
      <div class="room-area" id="roomArea">
        <div class="room-inner" id="roomInner">
          <div class="wall-top"></div><div class="wall-left"></div>
          <div class="wall-right"></div><div class="wall-bottom"></div>
          ${devHTML}
        </div>
      </div>
    </div>
    <div class="room-sidebar">
      <div class="scard">
        <div class="scard-title">Room Info</div>
        <div class="srow"><span class="srow-k">Total Devices</span><span class="srow-v">${room.devices.length}</span></div>
        ${statsRows}
      </div>
      ${deviceListItems ? `<div class="scard"><div class="scard-title">Device Status</div>${deviceListItems}</div>` : ''}
      <div class="scard">
        <div class="scard-title-row">
          <div class="scard-title">Beds</div>
          ${isAdmin() ? `<button class="btn-mini admin-only" data-action="add-bed" data-room="${room.id}">Add Bed</button>` : ''}
        </div>
        ${bedListItems || `<div class="note-empty">No beds in this room.</div>`}
      </div>
      <div class="scard">
        <div class="scard-title">Room Notes</div>
        ${noteRows(room.notes || [], 'room', room.id, room.id)}
        ${canAddNotes() ? `<div class="note-add-row"><textarea class="field-textarea" id="roomNoteInput_${room.id}" placeholder="Add a room note..."></textarea><button class="btn-sm ghost" data-action="add-note" data-note-target="room" data-target-id="${room.id}" data-room="${room.id}">Save Note</button></div>` : ''}
      </div>
      <div class="scard">
        <div class="scard-title">Legend</div>
        <div class="legend-row"><div class="legend-dot g"></div><span class="legend-lbl">Free to Use</span></div>
        <div class="legend-row"><div class="legend-dot r"></div><span class="legend-lbl">In Use / Not Available</span></div>
      </div>
    </div>
  </div>`;
}

let dragEl = null;
let dragOffX = 0;
let dragOffY = 0;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;
const DRAG_THRESHOLD = 2;
const GRID_SIZE = 2; // Very light hidden snap for more freedom
let gridOverlay = null;
let suppressDeviceClickUntil = 0;
let activePanelDeviceId = null;

function updateSelectedDeviceVisual() {
  try {
    document.querySelectorAll('.device.is-selected').forEach(el => el.classList.remove('is-selected'));
    if (!activePanelDeviceId) return;
    const el = document.querySelector(`.device[data-device-id="${activePanelDeviceId}"]`);
    if (el) el.classList.add('is-selected');
  } catch (e) { /* ignore */ }
}

function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

let layoutDirty = false;

function showLayoutBar() {
  layoutDirty = true;
  const bar = document.getElementById('layoutSaveBar');
  if (bar) bar.removeAttribute('hidden');
}

function hideLayoutBar() {
  layoutDirty = false;
  const bar = document.getElementById('layoutSaveBar');
  if (bar) bar.setAttribute('hidden', '');
}

function initDrag() {
  // attach pointer handlers to all devices; check draggability in handler
  document.querySelectorAll('.device').forEach(el => {
    el.removeEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerdown', onPointerDown, false);
    el.removeEventListener('click', onDeviceClick);
    el.addEventListener('click', onDeviceClick, false);
    el.style.touchAction = 'none';
  });
}

function onDeviceClick(e) {
  if (Date.now() < suppressDeviceClickUntil) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.target && e.target.closest && e.target.closest('.dev-del-btn')) return;
  const el = e.currentTarget;
  if (el.dataset.type === 'bed') return;
  e.preventDefault();
  e.stopPropagation();
  const devId = el.dataset.deviceId;
  const roomId = el.dataset.room;
  if (devId && roomId) {
    openPanel(devId, roomId);
  }
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  // allow clicks on inner controls (delete button) to pass through
  if (e.target && e.target.closest && e.target.closest('.dev-del-btn')) return;
  const el = e.currentTarget;
  // only start dragging for admin + draggable devices
  if (!isAdmin() || el.dataset.draggable !== 'true') return;
  e.preventDefault();
  const er = el.getBoundingClientRect();
  dragOffX = e.clientX - er.left;
  dragOffY = e.clientY - er.top;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragEl = el;
  dragMoved = false;
  if (el.setPointerCapture) {
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some browsers may reject pointer capture for certain input conditions.
    }
  }
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(e) {
  if (!dragEl) return;
  onMouseMove(e);
}

function onPointerUp(e) {
  if (dragEl && dragEl.releasePointerCapture) {
    try { dragEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  onMouseUp();
}

function onMouseDown(e) {
  if (e.button !== 0) return;
  if (e.target && e.target.closest && e.target.closest('.dev-del-btn')) return;
  e.preventDefault();
  const el = e.currentTarget;
  if (!isAdmin() || el.dataset.draggable !== 'true') return;
  const er = el.getBoundingClientRect();
  dragOffX = e.clientX - er.left;
  dragOffY = e.clientY - er.top;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragEl = el;
  dragMoved = false;
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function onTouchStart(e) {
  const touch = e.touches[0];
  // allow tapping buttons inside device to work
  if (e.target && e.target.closest && e.target.closest('.dev-del-btn')) return;
  e.preventDefault();
  const el = e.currentTarget;
  if (!isAdmin() || el.dataset.draggable !== 'true') return;
  const er = el.getBoundingClientRect();
  dragOffX = touch.clientX - er.left;
  dragOffY = touch.clientY - er.top;
  dragStartX = touch.clientX;
  dragStartY = touch.clientY;
  dragEl = el;
  dragMoved = false;
  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onMouseUp, { passive: false });
  document.addEventListener('touchcancel', onMouseUp, { passive: false });
}

function onTouchMove(e) {
  if (!dragEl) return;
  e.preventDefault();
  const touch = e.touches[0];
  onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
}

function onMouseMove(e) {
  if (!dragEl) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  if (!dragMoved && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
    dragMoved = true;
    dragEl.classList.add('dragging');
    showGridOverlay();
  }

  if (!dragMoved) return;

  const area = document.getElementById('roomArea');
  if (!area) return;
  const ar = area.getBoundingClientRect();
  let x = ((e.clientX - dragOffX - ar.left) / ar.width) * 100;
  let y = ((e.clientY - dragOffY - ar.top) / ar.height) * 100;
  const w = parseFloat(dragEl.style.width);
  const h = parseFloat(dragEl.style.height);
  // Prefer explicit data attributes for w/h, fall back to inline style
  const wAttr = parseFloat(dragEl.dataset.w);
  const hAttr = parseFloat(dragEl.dataset.h);
  const wFinal = !Number.isNaN(wAttr) ? wAttr : (Number.isFinite(w) ? w : 10);
  const hFinal = !Number.isNaN(hAttr) ? hAttr : (Number.isFinite(h) ? h : 10);

  // Apply snap-to-grid before bounds checking
  x = snapToGrid(x);
  y = snapToGrid(y);

  // Bounds checking - ensure device stays inside room
  x = Math.max(0, Math.min(100 - wFinal, x));
  y = Math.max(0, Math.min(100 - hFinal, y));
  
  dragEl.style.left = x + '%';
  dragEl.style.top = y + '%';
  positions[dragEl.dataset.deviceId] = { x, y };
}

function showGridOverlay() {
  return;
}

function hideGridOverlay() {
  return;
}

function onMouseUp() {
  if (dragEl) {
    dragEl.classList.remove('dragging');
    dragEl.style.transform = '';
    dragEl.style.transition = '';
    hideGridOverlay();
    suppressDeviceClickUntil = Date.now() + 250;
    if (!dragMoved) {
      const type = dragEl.dataset.type;
      if (type !== 'bed') {
        openPanel(dragEl.dataset.deviceId, dragEl.dataset.room);
      }
    } else {
      showLayoutBar();
    }
    dragEl = null;
    dragMoved = false;
  }
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);
  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onMouseUp);
  document.removeEventListener('touchcancel', onMouseUp);
  try { saveState(); } catch (e) { /* ignore */ }
}

function openPanel(devId, roomId) {
  const room = rooms.find(room => room.id === roomId);
  const device = room && room.devices.find(device => device.id === devId);
  if (!device) return;
  activePanelDeviceId = devId;
  buildPanel(device, room);
  const panelBg = document.getElementById('panelBg');
  if (panelBg) panelBg.classList.add('open');
  updateSelectedDeviceVisual();
}

function buildPanel(device, room) {
  const st = getDeviceState(device.id);
  const saved = st.savedFields || [];
  const admin = isAdmin();
  const meta = getStatusMeta(device.id);

  const customFieldsHTML = admin ? st.customFields.map((field, index) => `
    <div class="custom-field">
      <input type="text" placeholder="Key" value="${esc(field.k)}" data-action="set-field" data-device-id="${device.id}" data-index="${index}" data-field="k" style="flex:0.85">
      <input type="text" placeholder="Value" value="${esc(field.v)}" data-action="set-field" data-device-id="${device.id}" data-index="${index}" data-field="v">
      <button class="cf-del" data-action="delete-field" data-device-id="${device.id}" data-room="${room.id}" data-index="${index}">×</button>
    </div>`).join('') : '';

  const savedRows = saved.length ? saved.map(field => `
    <div class="pkv"><span class="pkv-k">${esc(field.k)}</span><span class="pkv-v">${esc(field.v)}</span></div>`).join('') : '';

  const statusDetails = `
    <div class="psec">
      <div class="psec-title">Status</div>
      ${statusBadgeHTML(meta)}
      ${meta.detail ? `<div class="status-detail">${esc(meta.detail)}</div>` : ''}
      ${canUpdateStatus() ? `
        <div class="field-group">
          <label class="field-label" for="statusSelect_${device.id}">Device Status</label>
          <select class="field-select" id="statusSelect_${device.id}" data-action="set-status" data-device-id="${device.id}" data-room="${room.id}">
            <option value="${STATUS.FREE}" ${meta.key === STATUS.FREE ? 'selected' : ''}>Free to Use</option>
            <option value="${STATUS.IN_USE}" ${meta.key === STATUS.IN_USE ? 'selected' : ''}>In Use</option>
            <option value="${STATUS.NOT_AVAILABLE}" ${meta.key === STATUS.NOT_AVAILABLE ? 'selected' : ''}>Not Available</option>
          </select>
        </div>
        ${meta.key === STATUS.IN_USE ? `
          <div class="emp-field">
            <span class="emp-label">IN USE BY</span>
            <input class="emp-input" id="empInput_${device.id}" value="${esc(st.employee || '')}" placeholder="Employee name" data-action="set-employee" data-device-id="${device.id}" data-room="${room.id}" />
          </div>` : ''}
        ${meta.key === STATUS.NOT_AVAILABLE ? `
          <div class="emp-field">
            <span class="emp-label">REASON</span>
            <textarea class="field-textarea" id="reasonInput_${device.id}" placeholder="Why is this not available?" data-action="set-unavailable-reason" data-device-id="${device.id}" data-room="${room.id}">${esc(st.notAvailableReason || '')}</textarea>
          </div>` : ''}
      ` : ''}
    </div>`;

  const notesSection = `
    <div class="psec">
      <div class="psec-title">Device Notes</div>
      ${noteRows(st.notes || [], 'device', device.id, room.id)}
      ${canAddNotes() ? `<div class="note-add-row"><textarea class="field-textarea" id="deviceNoteInput_${device.id}" placeholder="Add a device note..."></textarea><button class="add-field-btn" data-action="add-note" data-note-target="device" data-target-id="${device.id}" data-device-id="${device.id}" data-room="${room.id}">Save Note</button></div>` : ''}
    </div>`;

  const nameHTML = admin ? `
    <div class="inline-edit-wrap" id="nameView_${device.id}">
      <div class="panel-name">${esc(device.label)}</div>
      <button class="edit-name-btn" data-action="start-edit-name" data-device-id="${device.id}" data-room="${room.id}" title="Rename device">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2l3 3-8 8H1v-3l8-8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </button>
    </div>` : `<div class="panel-name">${esc(device.label)}</div>`;

  const customInfoHTML = admin ? `
    ${savedRows}
    ${customFieldsHTML}
    <button class="add-field-btn" data-action="add-field" data-device-id="${device.id}" data-room="${room.id}">+ Add Field</button>
  ` : savedRows;

  const saveChangesBar = (admin || canUpdateStatus()) ? `
    <div class="panel-save-bar" id="panelSaveBar_${device.id}" ${dirtyPanels.has(device.id) ? '' : 'hidden'}>
      <button class="save-panel-btn" data-action="save-panel" data-device-id="${device.id}" data-room="${room.id}">Save Changes</button>
    </div>
  ` : '';

  const panelEl = document.getElementById('panelEl');
  if (!panelEl) return;

  panelEl.innerHTML = `
    <div class="panel-hdr">
      <div class="panel-hdr-left">
        <span class="panel-hdr-t">${typeLabel[device.type]}</span>
        <span class="panel-hdr-sn">${esc(device.sn || '-')}</span>
      </div>
      <button class="panel-x" data-action="close-panel">×</button>
    </div>
    <div class="panel-body">
      <div class="panel-name-row">${nameHTML}</div>
      <div class="panel-type">${typeLabel[device.type]} · ${esc(room.name)}</div>
      <div class="psec">
        <div class="psec-title">Device Info</div>
        <div class="pkv"><span class="pkv-k">Serial No.</span><span class="pkv-v">${esc(device.sn || '-')}</span></div>
        <div class="pkv"><span class="pkv-k">Type</span><span class="pkv-v">${typeLabel[device.type]}</span></div>
        <div class="pkv"><span class="pkv-k">Room</span><span class="pkv-v">${esc(room.name)}</span></div>
        ${customInfoHTML}
      </div>
      ${statusDetails}
      ${notesSection}
      ${saveChangesBar}
    </div>`;
}

function startEditDevName(devId, roomId) {
  const room = rooms.find(room => room.id === roomId);
  const device = room && room.devices.find(device => device.id === devId);
  if (!device) return;
  const wrapper = document.getElementById(`nameView_${devId}`);
  if (!wrapper) return;
  wrapper.innerHTML = `
    <input class="inline-edit" id="nameInput_${devId}" value="${esc(device.label)}" data-action="save-dev-name" data-device-id="${devId}" data-room="${roomId}" />
    <button class="inline-save" data-action="save-dev-name" data-device-id="${devId}" data-room="${roomId}">Save</button>`;
  const input = document.getElementById(`nameInput_${devId}`);
  if (input) {
    input.focus();
    input.select();
  }
}

function saveDevName(devId, roomId) {
  const room = rooms.find(room => room.id === roomId);
  const device = room && room.devices.find(device => device.id === devId);
  if (!device) return;
  const input = document.getElementById(`nameInput_${devId}`);
  if (input && input.value.trim()) {
    device.label = input.value.trim();
  }
  refreshDeviceVisual(devId);
  buildPanel(device, room);
  try { saveState(); } catch (e) { /* ignore */ }
}

function savePanel(devId, roomId) {
  const st = getDeviceState(devId);
  const room = rooms.find(room => room.id === roomId);
  if (!room) return;

  const toSave = st.customFields.filter(field => field.k.trim());
  st.savedFields = [...(st.savedFields || []), ...toSave];
  st.customFields = [];

  const statusSelect = document.getElementById(`statusSelect_${devId}`);
  if (statusSelect && Object.values(STATUS).includes(statusSelect.value)) {
    st.status = statusSelect.value;
    st.inUse = st.status === STATUS.IN_USE;
  }

  const employeeInput = document.getElementById(`empInput_${devId}`);
  if (employeeInput) {
    st.employee = employeeInput.value.trim();
  }

  const reasonInput = document.getElementById(`reasonInput_${devId}`);
  if (reasonInput) {
    st.notAvailableReason = reasonInput.value.trim();
  }

  clearPanelDirty(devId);

  const device = room.devices.find(device => device.id === devId);
  if (device) {
    buildPanel(device, room);
    refreshDeviceVisual(devId);
    try { saveState(); } catch (e) { /* ignore */ }
  }
}

function toggleUse(devId, roomId, value) {
  const stateEntry = getDeviceState(devId);
  stateEntry.status = value ? STATUS.IN_USE : STATUS.FREE;
  stateEntry.inUse = value;
  if (!value) {
    stateEntry.employee = '';
  }
  refreshDeviceVisual(devId);

  const room = rooms.find(room => room.id === roomId);
  if (!room) return;
  const device = room.devices.find(device => device.id === devId);
  if (device) {
    buildPanel(device, room);
    try { saveState(); } catch (e) { /* ignore */ }
  }
}

function refreshDeviceVisual(devId) {
  const element = document.getElementById(`dev-${devId}`);
  if (!element) return;
  const meta = getStatusMeta(devId);
  const isFree = meta.key === STATUS.FREE;
  element.dataset.status = meta.key;
  const baseLabel = (element.getAttribute('aria-label') || '').split(' · ').slice(0, 2).join(' · ');
  element.setAttribute('aria-label', `${baseLabel || devId} · ${meta.label}`.trim());

  const chip = element.querySelector('.device-status-chip');
  if (chip) {
    chip.classList.remove('avail', 'inuse', 'notavail');
    chip.classList.add(meta.className);
    chip.innerHTML = `<span class="dot"></span>${esc(meta.shortLabel)}`;
  }

  const helloShape = element.querySelector('.hello-shape');
  if (helloShape) {
    helloShape.classList.toggle('in-use', !isFree);
    helloShape.classList.toggle('available', isFree);
    const dot = helloShape.querySelector('.hello-status-dot');
    if (dot) {
      dot.classList.toggle('active', !isFree);
      dot.classList.toggle('avail', isFree);
    }
  }

  const tvLed = element.querySelector('.tv-led');
  if (tvLed) {
    tvLed.classList.remove('avail', 'inuse', 'notavail');
    tvLed.classList.add(meta.className);
  }

  const wbLed = element.querySelector('.wb-led');
  if (wbLed) {
    wbLed.classList.remove('avail', 'inuse', 'notavail');
    wbLed.classList.add(meta.className);
  }

  const signBar = element.querySelector('.rsign-status-bar');
  if (signBar) {
    signBar.classList.remove('avail', 'inuse', 'notavail');
    signBar.classList.add(meta.className);
  }

  const signShape = element.querySelector('.rsign-shape');
  if (signShape) {
    signShape.classList.toggle('in-use', !isFree);
    signShape.classList.toggle('available', isFree);
  }
}

function addField(devId) {
  const stateEntry = getDeviceState(devId);
  stateEntry.customFields.push({ k: '', v: '' });
  const room = rooms.find(room => room.devices.some(device => device.id === devId));
  if (room) {
    const device = room.devices.find(device => device.id === devId);
    buildPanel(device, room);
    markPanelDirty(devId);
  }
}

function delField(devId, roomId, index) {
  const stateEntry = getDeviceState(devId);
  stateEntry.customFields.splice(index, 1);
  const room = rooms.find(room => room.id === roomId);
  if (room) {
    const device = room.devices.find(device => device.id === devId);
    buildPanel(device, room);
    markPanelDirty(devId);
  }
}

function setField(devId, index, key, value) {
  const stateEntry = getDeviceState(devId);
  if (!stateEntry.customFields[index]) return;
  stateEntry.customFields[index][key] = value;
  markPanelDirty(devId);
}

function updateDeviceStatus(devId, roomId, status) {
  const st = getDeviceState(devId);
  st.status = Object.values(STATUS).includes(status) ? status : STATUS.FREE;
  st.inUse = st.status === STATUS.IN_USE;
  if (st.status !== STATUS.IN_USE) st.employee = '';
  if (st.status !== STATUS.NOT_AVAILABLE) st.notAvailableReason = '';
  const room = rooms.find(room => room.id === roomId);
  const device = room && room.devices.find(device => device.id === devId);
  if (state.currentRoom && state.currentRoom.id === roomId) {
    render();
  } else {
    refreshDeviceVisual(devId);
  }
  if (device) {
    buildPanel(device, room);
    markPanelDirty(devId);
  }
}

function updateEmployee(devId, roomId, value) {
  const st = getDeviceState(devId);
  st.employee = value.trim();
  refreshDeviceVisual(devId);
  markPanelDirty(devId);
}

function updateUnavailableReason(devId, roomId, value) {
  const st = getDeviceState(devId);
  st.notAvailableReason = value.trim();
  refreshDeviceVisual(devId);
  markPanelDirty(devId);
}

function rebuildPanelForDevice(devId, roomId) {
  const room = rooms.find(room => room.id === roomId);
  const device = room && room.devices.find(device => device.id === devId);
  if (device) buildPanel(device, room);
}

function closePanel() {
  const panelBg = document.getElementById('panelBg');
  if (panelBg) panelBg.classList.remove('open');
  activePanelDeviceId = null;
  updateSelectedDeviceVisual();
}

// ─────────────────────────────────────────────────────────────────
//  Auth screen rendering — login, first-run setup, user management
// ─────────────────────────────────────────────────────────────────

function renderLogin(errorMsg = '') {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-brand">
        <div class="hdr-mark"></div>
        <span class="auth-brand-name">Hellocare Room Monitor</span>
      </div>
      <div class="auth-card">
        <h1 class="auth-title">Sign In</h1>
        <p class="auth-sub">Sign in to access the monitoring dashboard.</p>
        ${errorMsg ? `<div class="auth-error-banner">${esc(errorMsg)}</div>` : ''}
        <div class="field-group">
          <label class="field-label" for="loginUser">Username</label>
          <input class="field-input" id="loginUser" type="text" placeholder="Enter your username" autocomplete="username" />
        </div>
        <div class="field-group">
          <label class="field-label" for="loginPass">Password</label>
          <input class="field-input" id="loginPass" type="password" placeholder="Enter your password" autocomplete="current-password" />
        </div>
        <button class="btn-primary auth-submit-btn" data-action="do-login" type="button">Sign In</button>
      </div>
    </div>
  `;
  setTimeout(() => document.getElementById('loginUser')?.focus(), 60);
}

function renderSetup(errorMsg = '') {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div class="auth-screen">
      <div class="auth-brand">
        <div class="hdr-mark"></div>
        <span class="auth-brand-name">Hellocare Room Monitor</span>
      </div>
      <div class="auth-card">
        <h1 class="auth-title">Create Admin Account</h1>
        <p class="auth-sub">No accounts exist yet. Set up the first admin account to get started.</p>
        ${errorMsg ? `<div class="auth-error-banner">${esc(errorMsg)}</div>` : ''}
        <div class="field-group">
          <label class="field-label" for="setupUser">Username</label>
          <input class="field-input" id="setupUser" type="text" placeholder="e.g. admin" autocomplete="username" />
        </div>
        <div class="field-group">
          <label class="field-label" for="setupPass">Password</label>
          <input class="field-input" id="setupPass" type="password" placeholder="Choose a password (min 4 characters)" autocomplete="new-password" />
        </div>
        <div class="field-group">
          <label class="field-label" for="setupPass2">Confirm Password</label>
          <input class="field-input" id="setupPass2" type="password" placeholder="Repeat your password" autocomplete="new-password" />
        </div>
        <button class="btn-primary auth-submit-btn" data-action="do-setup" type="button">Create Account & Sign In</button>
      </div>
    </div>
  `;
  setTimeout(() => document.getElementById('setupUser')?.focus(), 60);
}

function renderUserMgmtContent() {
  const users = getAuthUsers();
  const session = getAuthSession();
  const userRows = users.map(u => {
    const isSelf = session && session.id === u.id;
    const isAdm  = u.role === 'admin';
    return `
    <div class="umgmt-row">
      <div class="umgmt-row-left">
        <span class="umgmt-username">${esc(u.username)}</span>
        ${isSelf ? '<span class="umgmt-you">you</span>' : ''}
        <span class="umgmt-role-chip ${u.role}">${isAdm ? 'Admin' : 'User'}</span>
      </div>
      <div class="umgmt-row-right">
        ${isSelf ? '<span class="umgmt-self-note">Your account</span>' : `
          <select class="field-select umgmt-role-select" data-action="change-user-role" data-user-id="${u.id}">
            <option value="admin" ${isAdm ? 'selected' : ''}>Admin</option>
            <option value="user" ${!isAdm ? 'selected' : ''}>User</option>
          </select>
          <button class="btn-mini danger" data-action="delete-user" data-user-id="${u.id}">Delete</button>
        `}
      </div>
    </div>`;
  }).join('');

  return `
    <div class="umgmt-list">
      ${userRows || '<p class="umgmt-empty">No users yet.</p>'}
    </div>
    <div class="umgmt-add-section">
      <div class="umgmt-add-title">Add New User</div>
      <div class="field-group">
        <label class="field-label">Username</label>
        <input class="field-input" id="newUserName" type="text" placeholder="Enter username" />
      </div>
      <div class="field-group">
        <label class="field-label">Password</label>
        <input class="field-input" id="newUserPass" type="password" placeholder="Minimum 4 characters" />
      </div>
      <div class="field-group">
        <label class="field-label">Role</label>
        <select class="field-select" id="newUserRole">
          <option value="user">User — can view and update device status</option>
          <option value="admin">Admin — full access including layout and users</option>
        </select>
      </div>
      <div class="auth-error-banner" id="addUserError" style="display:none;"></div>
      <button class="btn-primary" data-action="add-user" type="button">Add User</button>
    </div>
  `;
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = renderHeader() + (state.currentRoom ? renderRoom(state.currentRoom) : renderCorridor());
  document.body.classList.toggle('viewer', !isAdminSession());
  if (state.currentRoom) {
    setTimeout(initDrag, 40);
    setTimeout(updateSelectedDeviceVisual, 50);
  } else {
    activePanelDeviceId = null;
  }
}

  // hospital_room_monitor_v9.interaction.js — Interaction
let addDevRoomId = null;
let pendingConfirm = null;
let draggedRoomId = null;

function getDeviceId(target) {
  return target?.dataset?.deviceId || target?.dataset?.dev || target?.dataset?.id || '';
}

function isAdminRole() {
  return state.currentRole === 'admin';
}

function showToast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'opacity .18s, transform .18s';
    setTimeout(() => toast.remove(), 220);
  }, 2800);
}

function openConfirm({ title, message, confirmText = 'Confirm', danger = false, onConfirm }) {
  pendingConfirm = onConfirm;
  const modal = document.getElementById('confirmModal');
  const titleEl = document.getElementById('confirmTitle');
  const messageEl = document.getElementById('confirmMessage');
  const btn = document.getElementById('confirmBtn');
  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;
  if (btn) {
    btn.textContent = confirmText;
    btn.classList.toggle('danger', danger);
  }
  if (modal) modal.classList.add('open');
}

function closeConfirm() {
  pendingConfirm = null;
  const modal = document.getElementById('confirmModal');
  if (modal) modal.classList.remove('open');
}

function runConfirm() {
  const fn = pendingConfirm;
  closeConfirm();
  if (typeof fn === 'function') fn();
}

function markError(input, errorEl, message) {
  if (input) input.classList.add('error');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
  showToast(message, 'error');
}

function clearError(input, errorEl) {
  if (input) input.classList.remove('error');
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function validateName(value, label) {
  const name = normalizeText(value);
  if (!name) return `${label} is required.`;
  if (name.length > 80) return `${label} must be 80 characters or less.`;
  return '';
}

function validatePosition(value) {
  const position = Number.parseInt(value, 10);
  if (!Number.isInteger(position) || position < 1) return { valid: false, message: 'Position must be a number greater than 0.' };
  if (position > 100) return { valid: false, message: 'Position is too high. Use a value between 1 and 100.' };
  return { valid: true, value: position };
}

function validateSerialNumber(value) {
  const sn = normalizeText(value).toUpperCase();
  if (!sn) return { valid: false, message: 'Serial number is required.' };
  if (sn.length < 3 || sn.length > 64) return { valid: false, message: 'Serial number must be between 3 and 64 characters.' };
  if (!/^[A-Z0-9._-]+$/.test(sn)) return { valid: false, message: 'Serial number can only use letters, numbers, dots, underscores, and hyphens.' };
  if (getAllSNs().has(sn)) return { valid: false, message: 'This serial number already exists. Use a unique serial number.' };
  return { valid: true, value: sn };
}

function cleanupDeviceData(devId) {
  delete devState[devId];
  delete positions[devId];
}

function cleanupRoomData(room) {
  room.devices.forEach(device => cleanupDeviceData(device.id));
}

function findRoom(roomId) {
  return rooms.find(room => room.id === roomId);
}

function findDevice(roomId, devId) {
  const room = findRoom(roomId);
  return { room, device: room?.devices.find(device => device.id === devId) };
}

function openAddDevModal(roomId) {
  if (!isAdminRole()) return;
  addDevRoomId = roomId;
  const nameInput = document.getElementById('addDevName');
  const snInput = document.getElementById('addDevSN');
  const errorEl = document.getElementById('addDevSNErr');

  if (nameInput) nameInput.value = '';
  if (snInput) snInput.value = '';
  clearError(snInput, errorEl);

  const modal = document.getElementById('addDevModal');
  if (modal) modal.classList.add('open');
}

function confirmAddDevice() {
  if (!isAdminRole()) return;
  const nameInput = document.getElementById('addDevName');
  const snInput = document.getElementById('addDevSN');
  const typeSelect = document.getElementById('addDevType');
  const errorEl = document.getElementById('addDevSNErr');

  const name = normalizeText(nameInput?.value);
  const type = typeSelect ? typeSelect.value : 'hello';
  clearError(snInput, errorEl);

  const nameError = validateName(name, 'Device name');
  if (nameError) {
    markError(nameInput, null, nameError);
    return;
  }

  const snResult = validateSerialNumber(snInput?.value);
  if (!snResult.valid) {
    markError(snInput, errorEl, snResult.message);
    return;
  }

  const room = rooms.find(room => room.id === addDevRoomId);
  if (!room) {
    showToast('Room was not found.', 'error');
    return;
  }

  const id = uid('dev');
  const def = typeDefaults[type] || { w: 12, h: 12 };
  const device = {
    id,
    type,
    label: name,
    sn: snResult.value,
    x: 50,
    y: 40,
    w: def.w,
    h: def.h,
  };

  room.devices.push(device);
  initDevState(device);
  closeModal('addDevModal');
  render();
  saveState();
  showToast('Device added successfully.');
  setTimeout(initDrag, 40);
}

function addBedToRoom(roomId) {
  if (!isAdminRole()) return;
  const room = rooms.find(room => room.id === roomId);
  if (!room) {
    showToast('Room was not found.', 'error');
    return;
  }

  const bedCount = room.devices.filter(device => device.type === 'bed').length;
  const id = uid('bed');
  const def = typeDefaults.bed || { w: 20, h: 52 };
  let sn = `SN-BED-${id.toUpperCase()}`;
  const allSNs = getAllSNs();
  while (allSNs.has(sn.toLowerCase())) {
    sn = `SN-BED-${uid('bed').toUpperCase()}`;
  }

  const xOptions = [35, 8, 68, 22, 52];
  const yOptions = [36, 34, 34, 38, 38];
  const slot = bedCount % xOptions.length;
  const device = {
    id,
    type: 'bed',
    label: `Bed ${bedCount + 1}`,
    sn,
    x: xOptions[slot],
    y: yOptions[slot],
    w: def.w,
    h: def.h,
  };

  room.devices.push(device);
  initDevState(device);
  render();
  saveState();
  showToast('Bed added. Drag it into position.');
  setTimeout(initDrag, 40);
}

function deleteDevice(devId, roomId, event) {
  if (!isAdminRole()) return;
  if (event?.stopPropagation) event.stopPropagation();

  const room = rooms.find(room => room.id === roomId);
  if (!room) return;

  const index = room.devices.findIndex(device => device.id === devId);
  if (index === -1) return;
  const device = room.devices[index];

  const isBed = device.type === 'bed';

  openConfirm({
    title: isBed ? 'Delete Bed' : 'Delete Device',
    message: isBed
      ? `Delete "${device.label}"?

This will remove the bed from this room.`
      : `Delete "${device.label}" (${device.sn || 'no serial number'})?

This will also remove its status, position, notes, and saved custom fields.`,
    confirmText: isBed ? 'Delete Bed' : 'Delete Device',
    danger: true,
    onConfirm: () => {
      room.devices.splice(index, 1);
      cleanupDeviceData(devId);
      closePanel();
      render();
      saveState();
      showToast('Device deleted.', 'success');
      setTimeout(initDrag, 40);
    },
  });
}

function openAddRoomModal() {
  if (!isAdminRole()) return;
  const nameInput = document.getElementById('addRoomName');
  const sideSelect = document.getElementById('addRoomSide');
  const positionInput = document.getElementById('addRoomPos');

  if (nameInput) nameInput.value = '';
  if (sideSelect) sideSelect.value = 'left';
  if (positionInput) {
    positionInput.value = Math.max(...rooms.filter(room => room.floorId === state.currentFloorId).map(room => room.pos), 0) + 1;
    positionInput.classList.remove('error');
  }

  const modal = document.getElementById('addRoomModal');
  if (modal) modal.classList.add('open');
}

function confirmAddRoom() {
  if (!isAdminRole()) return;
  const nameInput = document.getElementById('addRoomName');
  const sideSelect = document.getElementById('addRoomSide');
  const positionInput = document.getElementById('addRoomPos');

  const name = normalizeText(nameInput?.value);
  const side = sideSelect ? sideSelect.value : 'left';
  const position = validatePosition(positionInput?.value);

  [nameInput, positionInput].forEach(input => input?.classList.remove('error'));

  const nameError = validateName(name, 'Room name');
  if (nameError) {
    markError(nameInput, null, nameError);
    return;
  }
  if (!position.valid) {
    markError(positionInput, null, position.message);
    return;
  }

  const nameLower = name.toLowerCase();
  if (rooms.some(r => r.floorId === state.currentFloorId && r.name?.toLowerCase() === nameLower)) {
    markError(nameInput, null, 'A room with that name already exists on this floor.');
    return;
  }

  const conflict = rooms.find(r => r.floorId === state.currentFloorId && r.side === side && r.pos === position.value);
  if (conflict) {
    markError(positionInput, null, `Position ${position.value} on the ${side} side is already used by ${conflict.name}. Choose another position.`);
    return;
  }

  const id = uid('room');
  rooms.push({ id, floorId: state.currentFloorId, name, side, pos: position.value, devices: [], notes: [] });
  closeModal('addRoomModal');
  render();
  saveState();
  showToast('Room added successfully.');
}

function openEditRoomModal(roomId) {
  if (!isAdminRole()) return;
  state.editingRoomId = roomId;
  const room = rooms.find(room => room.id === roomId);
  if (!room) return;

  const nameInput = document.getElementById('editRoomName');
  const sideSelect = document.getElementById('editRoomSide');
  const positionInput = document.getElementById('editRoomPos');

  if (nameInput) nameInput.value = room.name;
  if (sideSelect) sideSelect.value = room.side;
  if (positionInput) positionInput.value = room.pos;

  const modal = document.getElementById('editRoomModal');
  if (modal) modal.classList.add('open');
}

function confirmEditRoom() {
  if (!isAdminRole()) return;
  const room = rooms.find(room => room.id === state.editingRoomId);
  if (!room) return;

  const nameInput = document.getElementById('editRoomName');
  const sideSelect = document.getElementById('editRoomSide');
  const positionInput = document.getElementById('editRoomPos');

  const name = normalizeText(nameInput?.value);
  const side = sideSelect ? sideSelect.value : room.side;
  const position = validatePosition(positionInput?.value);

  [nameInput, positionInput].forEach(input => input?.classList.remove('error'));

  const nameError = validateName(name, 'Room name');
  if (nameError) {
    markError(nameInput, null, nameError);
    return;
  }
  if (!position.valid) {
    markError(positionInput, null, position.message);
    return;
  }

  const nameLower = name.toLowerCase();
  if (rooms.some(r => r.floorId === room.floorId && r.id !== room.id && r.name?.toLowerCase() === nameLower)) {
    markError(nameInput, null, 'Another room with that name already exists on this floor.');
    return;
  }

  const conflict = rooms.find(r => r.floorId === room.floorId && r.side === side && r.id !== room.id && r.pos === position.value);
  if (conflict) {
    markError(positionInput, null, `Position ${position.value} on the ${side} side is already used by ${conflict.name}. Choose another position.`);
    return;
  }

  room.name = name;
  room.side = side;
  room.pos = position.value;

  if (state.currentRoom?.id === state.editingRoomId) {
    state.currentRoom = room;
  }

  closeModal('editRoomModal');
  render();
  saveState();
  showToast('Room updated.');
  if (state.currentRoom) setTimeout(initDrag, 40);
}

function deleteRoom(roomId) {
  if (!isAdminRole()) return;
  const room = rooms.find(room => room.id === roomId);
  if (!room) return;
  const deviceCount = room.devices.length;
  const noteCount = Array.isArray(room.notes) ? room.notes.length : 0;

  openConfirm({
    title: 'Delete Room',
    message: `Delete "${room.name}"?\n\nThis room contains ${deviceCount} device${deviceCount === 1 ? '' : 's'} and ${noteCount} note${noteCount === 1 ? '' : 's'}. Deleting the room will permanently remove them.`,
    confirmText: 'Delete Room',
    danger: true,
    onConfirm: () => {
      cleanupRoomData(room);
      const index = rooms.findIndex(r => r.id === roomId);
      if (index !== -1) rooms.splice(index, 1);
      state.currentRoom = null;
      render();
      saveState();
      showToast('Room deleted.', 'success');
    },
  });
}

function openAddFloorModal() {
  if (!isAdminRole()) return;
  const nameInput = document.getElementById('addFloorName');
  if (nameInput) {
    nameInput.value = '';
    nameInput.classList.remove('error');
  }
  const modal = document.getElementById('addFloorModal');
  if (modal) modal.classList.add('open');
}

function confirmAddFloor() {
  if (!isAdminRole()) return;
  const nameInput = document.getElementById('addFloorName');
  const name = normalizeText(nameInput?.value);
  nameInput?.classList.remove('error');

  const nameError = validateName(name, 'Floor name');
  if (nameError) {
    markError(nameInput, null, nameError);
    return;
  }

  const nameLower = name.toLowerCase();
  if (floors.some(f => f.name?.toLowerCase() === nameLower)) {
    markError(nameInput, null, 'A floor/corridor with that name already exists.');
    return;
  }

  const id = uid('floor');
  floors.push({ id, name });
  state.currentFloorId = id;
  state.currentRoom = null;
  closeModal('addFloorModal');
  render();
  initSearchFilters();
  saveState();
  showToast('Floor added successfully.');
}

function openEditFloorModal(floorId) {
  if (!isAdminRole()) return;
  const floor = floors.find(floor => floor.id === floorId);
  if (!floor) return;
  state.editingFloorId = floorId;
  const input = document.getElementById('editFloorName');
  if (input) {
    input.value = floor.name;
    input.classList.remove('error');
  }
  const modal = document.getElementById('editFloorModal');
  if (modal) modal.classList.add('open');
}

function confirmEditFloor() {
  if (!isAdminRole()) return;
  const floor = floors.find(floor => floor.id === state.editingFloorId);
  const input = document.getElementById('editFloorName');
  if (!floor) return;
  const name = normalizeText(input?.value);
  input?.classList.remove('error');

  const nameError = validateName(name, 'Floor name');
  if (nameError) {
    markError(input, null, nameError);
    return;
  }
  const nameLower = name.toLowerCase();
  if (floors.some(f => f.id !== floor.id && f.name?.toLowerCase() === nameLower)) {
    markError(input, null, 'Another floor/corridor with that name already exists.');
    return;
  }

  floor.name = name;
  closeModal('editFloorModal');
  render();
  initSearchFilters();
  saveState();
  showToast('Floor updated.');
}

function deleteFloor(floorId) {
  if (!isAdminRole()) return;
  const floor = floors.find(floor => floor.id === floorId);
  if (!floor) return;
  if (floors.length <= 1) {
    showToast('At least one floor must remain.', 'error');
    return;
  }

  const floorRooms = rooms.filter(room => room.floorId === floorId);
  const deviceCount = floorRooms.reduce((sum, room) => sum + room.devices.length, 0);
  const noteCount = floorRooms.reduce((sum, room) => sum + (room.notes?.length || 0), 0);

  openConfirm({
    title: 'Delete Floor',
    message: `Delete "${floor.name}"?\n\nThis floor contains ${floorRooms.length} room${floorRooms.length === 1 ? '' : 's'}, ${deviceCount} device${deviceCount === 1 ? '' : 's'}, and ${noteCount} room note${noteCount === 1 ? '' : 's'}. This data will be permanently deleted.`,
    confirmText: 'Delete Floor',
    danger: true,
    onConfirm: () => {
      floorRooms.forEach(cleanupRoomData);
      for (let i = rooms.length - 1; i >= 0; i -= 1) {
        if (rooms[i].floorId === floorId) rooms.splice(i, 1);
      }
      const index = floors.findIndex(f => f.id === floorId);
      if (index !== -1) floors.splice(index, 1);
      state.currentFloorId = floors[0]?.id || '';
      state.currentRoom = null;
      render();
      initSearchFilters();
      saveState();
      showToast('Floor deleted.', 'success');
    },
  });
}


function normalizeRoomPositions(floorId, side) {
  const sideRooms = rooms
    .filter(room => room.floorId === floorId && room.side === side)
    .sort((a, b) => a.pos - b.pos);
  sideRooms.forEach((room, index) => {
    room.pos = index + 1;
  });
}

function moveRoomToSlot(roomId, targetSide, targetIndex) {
  const room = findRoom(roomId);
  if (!room) return false;
  const floorId = room.floorId;
  const sourceSide = room.side;
  const destination = Number.parseInt(targetIndex, 10);
  if (!Number.isInteger(destination) || destination < 1) return false;

  const currentSideRooms = rooms
    .filter(item => item.floorId === floorId && item.side === targetSide && item.id !== room.id)
    .sort((a, b) => a.pos - b.pos);
  const insertIndex = Math.max(0, Math.min(destination - 1, currentSideRooms.length));
  currentSideRooms.splice(insertIndex, 0, room);
  currentSideRooms.forEach((item, index) => {
    item.side = targetSide;
    item.pos = index + 1;
  });

  if (sourceSide !== targetSide) {
    normalizeRoomPositions(floorId, sourceSide);
  }
  return true;
}

function clearRoomDropState() {
  document.body.classList.remove('dragging-room');
  document.querySelectorAll('.room-slot').forEach(slot => slot.classList.remove('drag-over'));
}

function handleRoomDragStart(event) {
  const roomBtn = event.target?.closest?.('[data-room-draggable="true"]');
  if (!roomBtn || !isAdminRole() || state.currentRoom) return;
  draggedRoomId = roomBtn.dataset.room || '';
  roomBtn.classList.add('dragging-room');
  document.body.classList.add('dragging-room');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedRoomId);
  }
}

function handleRoomDragOver(event) {
  const slot = event.target?.closest?.('[data-room-slot="true"]');
  if (!slot || !draggedRoomId || state.currentRoom) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function handleRoomDragEnter(event) {
  const slot = event.target?.closest?.('[data-room-slot="true"]');
  if (!slot || !draggedRoomId || state.currentRoom) return;
  slot.classList.add('drag-over');
}

function handleRoomDragLeave(event) {
  const slot = event.target?.closest?.('[data-room-slot="true"]');
  if (!slot) return;
  const related = event.relatedTarget;
  if (related && slot.contains(related)) return;
  slot.classList.remove('drag-over');
}

function handleRoomDrop(event) {
  const slot = event.target?.closest?.('[data-room-slot="true"]');
  if (!slot || !draggedRoomId || state.currentRoom) return;
  event.preventDefault();
  slot.classList.remove('drag-over');
  const room = findRoom(draggedRoomId);
  if (!room) {
    clearRoomDropState();
    draggedRoomId = null;
    return;
  }
  const targetSide = slot.dataset.side;
  const targetIndex = slot.dataset.slotIndex;
  const currentRoomId = slot.dataset.roomId || '';
  if (room.id === currentRoomId && room.side === targetSide && String(room.pos) === String(targetIndex)) {
    clearRoomDropState();
    document.querySelectorAll('[data-room-draggable="true"]').forEach(el => el.classList.remove('dragging-room'));
    draggedRoomId = null;
    return;
  }
  const moved = moveRoomToSlot(draggedRoomId, targetSide, targetIndex);
  clearRoomDropState();
  document.querySelectorAll('[data-room-draggable="true"]').forEach(el => el.classList.remove('dragging-room'));
  draggedRoomId = null;
  if (!moved) return;
  render();
  saveState();
  showLayoutBar();
  showToast('Room layout updated.');
}

function handleRoomDragEnd() {
  document.querySelectorAll('[data-room-draggable="true"]').forEach(el => el.classList.remove('dragging-room'));
  clearRoomDropState();
  draggedRoomId = null;
}

function openRoom(roomId) {
  state.currentRoom = rooms.find(room => room.id === roomId) || null;
  render();
  setTimeout(initDrag, 40);
}

function goBack() {
  state.currentRoom = null;
  render();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
}

function addNote(target, event) {
  const noteTarget = target.dataset.noteTarget;
  const targetId = target.dataset.targetId;
  const roomId = target.dataset.room;
  const inputId = noteTarget === 'room' ? `roomNoteInput_${targetId}` : `deviceNoteInput_${targetId}`;
  const input = document.getElementById(inputId);
  const text = normalizeText(input?.value);
  if (!text) {
    showToast('Note text is required.', 'error');
    input?.focus();
    return;
  }
  if (text.length > 600) {
    showToast('Note must be 600 characters or less.', 'error');
    return;
  }

  const note = {
    id: noteUid(),
    text,
    author: state.currentRole === 'admin' ? 'Admin' : 'Employee',
    createdAt: new Date().toISOString(),
  };

  if (noteTarget === 'room') {
    const room = findRoom(targetId);
    if (!room) return;
    if (!Array.isArray(room.notes)) room.notes = [];
    room.notes.unshift(note);
    if (input) input.value = '';
    state.currentRoom = room;
    render();
    saveState();
    showToast('Room note added.');
    return;
  }

  if (noteTarget === 'device') {
    const { room, device } = findDevice(roomId, targetId);
    if (!room || !device) return;
    const st = getDeviceState(targetId);
    if (!Array.isArray(st.notes)) st.notes = [];
    st.notes.unshift(note);
    if (input) input.value = '';
    rebuildPanelForDevice(targetId, roomId);
    saveState();
    showToast('Device note added.');
  }
}

function deleteNote(target) {
  if (!isAdminRole()) return;
  const noteTarget = target.dataset.noteTarget;
  const targetId = target.dataset.targetId;
  const roomId = target.dataset.room;
  const noteId = target.dataset.noteId;

  openConfirm({
    title: 'Delete Note',
    message: 'Delete this note permanently?',
    confirmText: 'Delete Note',
    danger: true,
    onConfirm: () => {
      if (noteTarget === 'room') {
        const room = findRoom(targetId);
        if (!room) return;
        room.notes = (room.notes || []).filter(note => note.id !== noteId);
        state.currentRoom = room;
        render();
      } else if (noteTarget === 'device') {
        const st = getDeviceState(targetId);
        st.notes = (st.notes || []).filter(note => note.id !== noteId);
        rebuildPanelForDevice(targetId, roomId);
      }
      saveState();
      showToast('Note deleted.', 'success');
    },
  });
}

function clearSearchFilters() {
  const input = document.getElementById('snSearchInput');
  const floorSelect = document.getElementById('filterFloor');
  const roomInput = document.getElementById('filterRoom');
  const typeSelect = document.getElementById('filterType');
  const statusSelect = document.getElementById('filterStatus');
  if (input) input.value = '';
  if (floorSelect) floorSelect.value = 'all';
  if (roomInput) roomInput.value = '';
  if (typeSelect) typeSelect.value = 'all';
  if (statusSelect) statusSelect.value = 'all';
  state.searchFilters = { floorId: 'all', room: '', type: 'all', status: 'all' };
  clearSearch();
  saveState();
}

function handleClick(event) {
  const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;
  const actionEl = target?.closest?.('[data-action]');
  const action = actionEl ? actionEl.dataset.action : null;

  if (action === 'close-panel' && actionEl.id === 'panelBg' && target !== actionEl) return;

  if (action === 'do-login') {
    const username = document.getElementById('loginUser')?.value || '';
    const password = document.getElementById('loginPass')?.value || '';
    login(username, password).then(result => {
      if (!result.ok) { renderLogin(result.error); return; }
      initApp();
      render();
    });
    return;
  }

  if (action === 'do-setup') {
    const username = document.getElementById('setupUser')?.value || '';
    const password = document.getElementById('setupPass')?.value || '';
    const confirm  = document.getElementById('setupPass2')?.value || '';
    if (password !== confirm) { renderSetup('Passwords do not match.'); return; }
    createUser(username, password, 'admin').then(result => {
      if (!result.ok) { renderSetup(result.error); return; }
      login(username, password).then(() => { initApp(); render(); });
    });
    return;
  }

  if (action === 'do-logout') {
    logout();
    state.currentRoom = null;
    renderLogin();
    return;
  }

  if (action === 'open-user-mgmt') {
    const modal = document.getElementById('userMgmtModal');
    const body  = document.getElementById('userMgmtBody');
    if (body) body.innerHTML = renderUserMgmtContent();
    if (modal) modal.classList.add('open');
    return;
  }

  if (action === 'add-user') {
    const username = document.getElementById('newUserName')?.value || '';
    const password = document.getElementById('newUserPass')?.value || '';
    const role     = document.getElementById('newUserRole')?.value || 'user';
    const errorEl  = document.getElementById('addUserError');
    createUser(username, password, role).then(result => {
      if (!result.ok) {
        if (errorEl) { errorEl.textContent = result.error; errorEl.style.display = 'block'; }
        return;
      }
      const body = document.getElementById('userMgmtBody');
      if (body) body.innerHTML = renderUserMgmtContent();
      showToast(`User "${result.user.username}" added.`, 'success');
    });
    return;
  }

  if (action === 'delete-user') {
    const userId = actionEl.dataset.userId;
    const users  = getAuthUsers();
    const user   = users.find(u => u.id === userId);
    if (!user) return;
    openConfirm({
      title: 'Delete User',
      message: `Delete "${user.username}"? This cannot be undone.`,
      confirmText: 'Delete User',
      danger: true,
      onConfirm: () => {
        const result = removeUser(userId);
        if (!result.ok) { showToast(result.error, 'error'); return; }
        const body = document.getElementById('userMgmtBody');
        if (body) body.innerHTML = renderUserMgmtContent();
        showToast('User deleted.', 'success');
      },
    });
    return;
  }

  if (action === 'toggle-role') {
    // deprecated — no-op
    return;
  }

  if (action && actionHandlers[action]) {
    actionHandlers[action](actionEl, event);
    return;
  }

  const searchResults = document.getElementById('searchResults');
  const searchInput = document.getElementById('snSearchInput');
  if (searchResults && searchInput && !searchResults.contains(target) && target !== searchInput) {
    clearSearch();
  }
}

const actionHandlers = {
  'goto-device': target => goToDevice(getDeviceId(target), target.dataset.room),
  'switch-floor': target => switchFloor(target.dataset.floor),
  'open-room': target => openRoom(target.dataset.room),
  'add-floor': () => openAddFloorModal(),
  'edit-floor': target => openEditFloorModal(target.dataset.floor),
  'delete-floor': target => deleteFloor(target.dataset.floor),
  'add-room': () => openAddRoomModal(),
  'add-device': target => openAddDevModal(target.dataset.room),
  'add-bed': target => addBedToRoom(target.dataset.room),
  'edit-room': target => openEditRoomModal(target.dataset.room),
  'delete-room': target => deleteRoom(target.dataset.room),
  'go-back': () => goBack(),
  'close-panel': () => closePanel(),
  'close-modal': target => closeModal(target.dataset.modal),
  'confirm-add-device': () => confirmAddDevice(),
  'confirm-add-room': () => confirmAddRoom(),
  'confirm-edit-room': () => confirmEditRoom(),
  'confirm-add-floor': () => confirmAddFloor(),
  'confirm-edit-floor': () => confirmEditFloor(),
  'delete-device': (target, event) => deleteDevice(getDeviceId(target), target.dataset.room, event),
  'delete-field': target => delField(getDeviceId(target), target.dataset.room, Number.parseInt(target.dataset.index, 10)),
  'add-field': target => addField(getDeviceId(target)),
  'save-panel': target => { savePanel(getDeviceId(target), target.dataset.room); showToast('Changes saved.'); },
  'start-edit-name': target => startEditDevName(getDeviceId(target), target.dataset.room),
  'save-dev-name': target => saveDevName(getDeviceId(target), target.dataset.room),
  'clear-filters': () => clearSearchFilters(),
  'cancel-confirm': () => closeConfirm(),
  'confirm-action': () => runConfirm(),
  'add-note': (target, event) => addNote(target, event),
  'delete-note': target => deleteNote(target),
  'save-layout': () => { saveState(); hideLayoutBar(); showToast('Layout saved.', 'success'); },
  'dismiss-layout-bar': () => hideLayoutBar(),
};

function initSearchFilters() {
  const floorSelect = document.getElementById('filterFloor');
  const roomInput = document.getElementById('filterRoom');
  const typeSelect = document.getElementById('filterType');
  const statusSelect = document.getElementById('filterStatus');

  if (floorSelect) {
    const existing = floorSelect.value;
    floorSelect.innerHTML = '<option value="all">All floors</option>' + floors.map(floor => `
      <option value="${floor.id}">${esc(floor.name)}</option>`).join('');
    floorSelect.value = state.searchFilters.floorId || existing || 'all';
  }
  if (roomInput) roomInput.value = state.searchFilters.room || '';
  if (typeSelect) typeSelect.value = state.searchFilters.type || 'all';
  if (statusSelect) statusSelect.value = state.searchFilters.status || 'all';
}

function updateSearchFilters() {
  const floorSelect = document.getElementById('filterFloor');
  const roomInput = document.getElementById('filterRoom');
  const typeSelect = document.getElementById('filterType');
  const statusSelect = document.getElementById('filterStatus');
  if (floorSelect) state.searchFilters.floorId = floorSelect.value;
  if (roomInput) state.searchFilters.room = roomInput.value.trim();
  if (typeSelect) state.searchFilters.type = typeSelect.value;
  if (statusSelect) state.searchFilters.status = statusSelect.value;
  saveState();
}

function isSearchControl(target) {
  return ['snSearchInput', 'filterFloor', 'filterRoom', 'filterType', 'filterStatus'].includes(target?.id);
}

function handleSearchInput() {
  updateSearchFilters();
  handleSearch(document.getElementById('snSearchInput')?.value || '');
}

function initApp() {
  initSearchFilters();

  document.addEventListener('input', event => {
    const target = event.target;
    if (!target) return;

    if (isSearchControl(target)) {
      handleSearchInput();
      return;
    }

    if (target.dataset.action === 'set-field') {
      const devId = getDeviceId(target);
      const index = Number.parseInt(target.dataset.index, 10);
      const field = target.dataset.field;
      if (devId && !Number.isNaN(index) && field) {
        const st = getDeviceState(devId);
        if (st.customFields[index]) st.customFields[index][field] = target.value;
        markPanelDirty(devId);
      }
      return;
    }

    if (target.dataset.action === 'set-employee') {
      updateEmployee(getDeviceId(target), target.dataset.room, target.value);
      return;
    }

    if (target.dataset.action === 'set-unavailable-reason') {
      updateUnavailableReason(getDeviceId(target), target.dataset.room, target.value);
    }
  });

  document.addEventListener('change', event => {
    const target = event.target;
    if (!target) return;

    if (isSearchControl(target)) {
      handleSearchInput();
      return;
    }

    if (target.dataset.action === 'toggle-use') {
      toggleUse(getDeviceId(target), target.dataset.room, target.checked);
      showToast(target.checked ? 'Device marked as in use.' : 'Device marked as free.');
      return;
    }

    if (target.dataset.action === 'change-user-role') {
      const userId  = target.dataset.userId;
      const newRole = target.value;
      const result  = setUserRole(userId, newRole);
      if (!result.ok) {
        showToast(result.error, 'error');
        // Reset the dropdown to reflect actual state
        const body = document.getElementById('userMgmtBody');
        if (body) body.innerHTML = renderUserMgmtContent();
        return;
      }
      showToast('Role updated.', 'success');
      return;
    }

    if (target.dataset.action === 'set-status') {
      updateDeviceStatus(getDeviceId(target), target.dataset.room, target.value);
      const label = target.value === STATUS.FREE ? 'free to use' : target.value === STATUS.IN_USE ? 'in use' : 'not available';
      showToast(`Device marked as ${label}.`);
    }
  });

  document.addEventListener('keydown', event => {
    const target = event.target;
    if (target?.id === 'snSearchInput' && event.key === 'Escape') {
      clearSearch();
      return;
    }
    // Submit login / setup forms on Enter
    if (event.key === 'Enter') {
      if (target?.id === 'loginPass' || target?.id === 'loginUser') {
        document.querySelector('[data-action="do-login"]')?.click();
        return;
      }
      if (target?.id === 'setupPass2' || target?.id === 'setupPass' || target?.id === 'setupUser') {
        document.querySelector('[data-action="do-setup"]')?.click();
        return;
      }
    }
    if (target?.dataset?.action === 'save-dev-name' && event.key === 'Enter') {
      saveDevName(getDeviceId(target), target.dataset.room);
      showToast('Device name saved.');
      return;
    }

    const active = document.activeElement;
    if (active?.classList?.contains('device')) {
      const devId = active.dataset.deviceId;
      const roomId = active.dataset.room;
      if (!devId || !roomId) return;

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPanel(devId, roomId);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && isAdminRole()) {
        event.preventDefault();
        deleteDevice(devId, roomId, event);
        return;
      }

      if (isAdminRole() && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const currentX = Number.parseFloat(active.style.left) || 0;
        const currentY = Number.parseFloat(active.style.top) || 0;
        const p = positions[devId] || { x: currentX, y: currentY };
        const gridSize = 2;
        const w = Number.parseFloat(active.dataset.w) || Number.parseFloat(active.style.width) || 10;
        const h = Number.parseFloat(active.dataset.h) || Number.parseFloat(active.style.height) || 10;
        const maxX = Math.max(0, 100 - w);
        const maxY = Math.max(0, 100 - h);

        if (event.key === 'ArrowLeft') p.x = Math.max(0, p.x - gridSize);
        if (event.key === 'ArrowRight') p.x = Math.min(maxX, p.x + gridSize);
        if (event.key === 'ArrowUp') p.y = Math.max(0, p.y - gridSize);
        if (event.key === 'ArrowDown') p.y = Math.min(maxY, p.y + gridSize);

        positions[devId] = p;
        active.style.left = p.x + '%';
        active.style.top = p.y + '%';
        saveState();
      }
    }
  });

  document.addEventListener('focusin', event => {
    const target = event.target;
    if (target?.id === 'snSearchInput' && target.value) {
      handleSearch(target.value);
    }
  });

  document.addEventListener('dragstart', handleRoomDragStart);
  document.addEventListener('dragover', handleRoomDragOver);
  document.addEventListener('dragenter', handleRoomDragEnter);
  document.addEventListener('dragleave', handleRoomDragLeave);
  document.addEventListener('drop', handleRoomDrop);
  document.addEventListener('dragend', handleRoomDragEnd);
  document.addEventListener('click', handleClick);
}

  // hospital_room_monitor_v9.js — Entry point
loadAuth();
initState();

if (isFirstRun()) {
  renderSetup();
} else if (!isLoggedIn()) {
  renderLogin();
} else {
  initApp();
  render();
}

})();
