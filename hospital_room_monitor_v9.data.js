import {
  isAdminSession,
  isLoggedIn,
} from './hospital_room_monitor_v9.auth.js';

const debugStore = DEBUG_HRM ? (window.HRM = window.HRM || {}) : {};
if (!DEBUG_HRM && typeof window !== 'undefined' && window.HRM) {
  try { delete window.HRM; } catch (e) { window.HRM = undefined; }
}

export const STATUS = {
  FREE: 'free',
  IN_USE: 'inuse',
  NOT_AVAILABLE: 'not_available',
};

export const state = debugStore.state = {
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

export function toggleRoleState() {
  // no-op — roles are managed through real user accounts now
}

export function uid(prefix = 'dev') {
  return prefix + (++state.uidCounter);
}

export function noteUid() {
  return 'note' + (++state.uidCounter);
}

export const floors = debugStore.floors = [
  { id:'f1', name:'Floor 1 - Corridor A' },
  { id:'f2', name:'Floor 2 - Corridor B' },
];

export const rooms = debugStore.rooms = [
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

export const devState = debugStore.devState = {};

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

export const positions = debugStore.positions = {};
export function pos(dev) {
  const p = positions[dev.id] || { x: dev.x, y: dev.y };
  // clamp saved/loaded positions to valid area so devices never render outside room
  const w = (dev.w || 10);
  const h = (dev.h || 10);
  p.x = Math.max(0, Math.min(100 - w, p.x));
  p.y = Math.max(0, Math.min(100 - h, p.y));
  return p;
}

const STORAGE_KEY = 'hrm_v9_state_v1';

export function saveState() {
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

export function loadState() {
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
