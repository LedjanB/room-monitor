import {
  isAdminSession,
  getAuthSession,
  getAuthUsers,
} from './hospital_room_monitor_v9.auth.js';
import {
  state,
  floors,
  rooms,
  STATUS,
  devState,
  positions,
  pos,
  isAdmin,
  canUpdateStatus,
  canAddNotes,
  getDeviceState,
  getStatusMeta,
  getRoomStatusCounts,
  esc,
  typeLabel,
  saveState,
  saveDeviceState,
  saveDevicePosition,
  saveLocalUIState,
  typeDefaults,
  devSummary,
  roomHasInUse,
  bedSVG,
  broadcastActivity,
  getNotifications,
  getUnreadNotificationCount,
  serverNow,
} from './hospital_room_monitor_v9.data.js';

function statusLabel(status) {
  if (status === STATUS.IN_USE) return 'in use';
  if (status === STATUS.NOT_AVAILABLE) return 'not available';
  return 'free to use';
}

function announceStatusChange(device, room, newStatus) {
  const who = getAuthSession()?.username || 'Someone';
  broadcastActivity(`${who} marked ${device.label} (${room.name}) as ${statusLabel(newStatus)}.`);
}

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

function formatSinceLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diffMs = Math.max(0, serverNow() - ts);
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  const ago = hours > 0 ? `${hours}h ${mins}m ago` : `${mins}m ago`;
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);
  const sameDay = new Date().toDateString() === d.toDateString();
  const when = sameDay ? time : `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d)}, ${time}`;
  return `${when} (${ago})`;
}

/** Who may delete a given note: an admin (any note), or the person who
 *  wrote it. Notes created from now on carry the author's uid; older ones
 *  only have the username string, so fall back to matching on that. */
export function canDeleteNote(note) {
  if (!note) return false;
  if (isAdmin()) return true;
  const session = getAuthSession();
  if (!session) return false;
  if (note.authorId) return note.authorId === session.id;
  return String(note.author || '').trim().toLowerCase()
    === String(session.username || '').trim().toLowerCase();
}

const NOTE_TTL_HINT = 'Notes are removed automatically 48 hours after they are added.';

function noteRows(notes = [], targetType, targetId, roomId = '') {
  if (!notes.length) return '<div class="note-empty">No notes yet.</div>';
  return `<div class="note-list">${notes.map(note => `
    <div class="note-item">
      <div class="note-body">
        <div class="note-text">${esc(note.text || '')}</div>
        <div class="note-meta">${esc(note.author || 'Employee')} · ${esc(formatNoteDate(note.createdAt))}</div>
      </div>
      ${canDeleteNote(note) ? `<button class="note-del" data-action="delete-note" data-note-target="${targetType}" data-target-id="${targetId}" data-room="${roomId}" data-note-id="${note.id}" title="Delete note">×</button>` : ''}
    </div>`).join('')}</div>`;
}

function statusBadgeHTML(meta) {
  return `<div class="status-badge ${meta.className}"><div class="sbdot"></div>${esc(meta.label)}</div>`;
}

export function renderNotificationsList() {
  const items = getNotifications();
  if (!items.length) return '<div class="note-empty">No activity in the last 12 hours.</div>';
  return `<div class="note-list">${items.map(n => `
    <div class="note-item">
      <div class="note-body">
        <div class="note-text">${esc(n.message)}</div>
        <div class="note-meta">${esc(formatNoteDate(n.ts))}</div>
      </div>
    </div>`).join('')}</div>`;
}

const dirtyPanels = new Set();
// Snapshot of each open panel's last-SAVED device state (not the live
// dropdown preview), captured once when the panel opens. Used by
// savePanel() to tell whether the status actually changed (worth
// announcing), and by closePanel() to roll back unsaved preview edits —
// the dropdown mutates shared in-memory state for its live preview, so
// abandoning the panel without saving must undo that or the tiles keep
// showing a status that was never persisted.
const panelOpenedStatus = new Map();

export function markPanelDirty(devId) {
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

export function deviceHTML(dev, room) {
  const st = getDeviceState(dev.id);
  const meta = getStatusMeta(dev.id);
  const sizeScale = {
    bed: { w: 0.84, h: 0.84 },
    tv: { w: 0.82, h: 0.90 },
    whiteboard: { w: 0.92, h: 0.92 },
    hello: { w: 0.80, h: 0.80 },
  }[dev.type] || { w: 1, h: 1 };
  const displayW = Math.max(1, Number(((dev.w || 10) * sizeScale.w).toFixed(2)));
  const displayH = Math.max(1, Number(((dev.h || 10) * sizeScale.h).toFixed(2)));
  const p = pos(dev, displayW, displayH);
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

  const quickToggle = (dev.type !== 'bed' && canUpdateStatus())
    ? `<button class="dev-quick-toggle ${meta.className}" data-action="cycle-status" data-device-id="${dev.id}" data-room="${room.id}" title="Click to cycle status (currently ${meta.label})" aria-label="Cycle status, currently ${meta.label}"></button>`
    : '';

  const draggable = isAdmin();

  const aria = `${esc(dev.label)} · ${typeLabel[dev.type]} · ${meta.label}`;
  return `<div class="device" id="dev-${dev.id}"
    style="left:${p.x}%;top:${p.y}%;width:${displayW}%;height:${displayH}%;"
    data-device-id="${dev.id}" data-room="${room.id}" data-type="${dev.type}" data-status="${meta.key}" data-w="${displayW}" data-h="${displayH}"
    data-label="${esc(dev.label)}"
    data-draggable="${draggable}" tabindex="0" role="button" aria-label="${esc(aria)}">
    ${delBtn}
    ${quickToggle}
    <div class="viewer-lock"></div>
    ${inner}
  </div>`;
}

export function renderHeader() {
  const floorRooms = rooms.filter(r => r.floorId === state.currentFloorId);
  const tot = rooms.reduce((sum, room) => sum + (room.devices?.length || 0), 0);
  const session = getAuthSession();
  const isAdm = isAdminSession();
  const roleChip = session
    ? `<span class="hdr-role-chip ${session.role === 'admin' ? 'admin' : 'user'}">${session.role === 'admin' ? 'Admin' : 'User'}</span>`
    : '';
  const unread = session ? getUnreadNotificationCount() : 0;

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
      <button class="hdr-quick-btn" data-action="show-free-now" type="button" title="Show every free device across all floors">Free Now</button>
      <div class="hdr-pill">${floorRooms.length} ROOMS</div>
      <div class="hdr-pill">${tot} DEVICES</div>
      ${session ? `
        <button class="hdr-bell-btn" data-action="open-notifications" type="button" title="Recent activity">
          🔔<span class="hdr-bell-badge" id="notifBadge" ${unread === 0 ? 'hidden' : ''}>${unread > 99 ? '99+' : unread}</span>
        </button>
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

// Which device types matter most when scanning results / "what's free
// right now". Anything not listed sorts to the end.
const SEARCH_TYPE_ORDER = { hello: 0, whiteboard: 1, tv: 2, roomsign: 3, bed: 4 };

export function handleSearch(value) {
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
      results.push({ device, room, floor, meta, st });
    });
  });

  if (!results.length) {
    const details = chips.length ? chips.join(' · ') : value;
    list.innerHTML = `<span class="sr-empty">No devices found for ${esc(details || 'the selected filters')}.</span>`;
    return;
  }

  // Results (including Free Now, which is just this list with a status
  // filter applied) lead with the devices people actually go looking for:
  // Hellos first, then whiteboards, then TVs, then everything else.
  results.sort((a, b) => {
    const order = SEARCH_TYPE_ORDER[a.device.type] ?? 99;
    const otherOrder = SEARCH_TYPE_ORDER[b.device.type] ?? 99;
    if (order !== otherOrder) return order - otherOrder;
    const floorName = a.floor?.name || '';
    const otherFloorName = b.floor?.name || '';
    if (floorName !== otherFloorName) return floorName.localeCompare(otherFloorName, undefined, { numeric: true });
    if (a.room.name !== b.room.name) return a.room.name.localeCompare(b.room.name, undefined, { numeric: true });
    return String(a.device.label || '').localeCompare(String(b.device.label || ''), undefined, { numeric: true });
  });

  let lastType = null;
  const rows = results.map(({ device, room, floor, meta, st }) => {
    const since = meta.key !== STATUS.FREE && st.since ? `<span class="sr-since">${esc(formatSinceLabel(st.since))}</span>` : '';
    // A heading per type group, so the priority ordering reads as
    // intentional rather than as an arbitrary shuffle.
    const groupCount = results.filter(r => r.device.type === device.type).length;
    const heading = device.type !== lastType
      ? `<div class="sr-group">${typeLabel[device.type] || device.type} <span class="sr-group-n">${groupCount}</span></div>`
      : '';
    lastType = device.type;
    return `${heading}<div class="sr-item" data-action="goto-device" data-device-id="${device.id}" data-room="${room.id}">
      <span class="sr-sn">${esc(device.sn || device.label)}</span>
      <span class="sr-meta">${esc(device.label)} · ${esc(room.name)} · ${floor ? esc(floor.name) : ''} · ${typeLabel[device.type]}</span>
      <span class="sr-status ${meta.className}">${esc(meta.label)}</span>
      ${since}
    </div>`;
  }).join('');

  list.innerHTML = `<div class="sr-count">${results.length} result${results.length === 1 ? '' : 's'}</div>` + rows;
}

export function clearSearch() {
  const sr = document.getElementById('searchResults');
  const input = document.getElementById('snSearchInput');
  if (sr) sr.classList.remove('open');
  if (input) input.value = '';
}

export function goToDevice(devId, roomId) {
  clearSearch();
  const room = rooms.find(room => room.id === roomId);
  if (!room) return;
  state.currentFloorId = room.floorId;
  state.currentRoom = room;
  saveLocalUIState(); // persist the floor switch, same as switchFloor()
  render();
  setTimeout(initDrag, 40);
  if (room.devices.some(device => device.id === devId && device.type !== 'bed')) {
    openPanel(devId, roomId);
  }
  // render() re-creates the tiles, so the highlight has to be re-applied
  // after that DOM swap settles (same 40ms beat as initDrag above).
  setTimeout(() => updateSelectedDeviceVisual({ reveal: true }), 60);
}

export function switchFloor(floorId) {
  state.currentFloorId = floorId;
  state.currentRoom = null;
  saveLocalUIState();
  render();
}

export function renderCorridor() {
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

  // Floor-wide status totals — the "what's free right now" answer a status
  // board exists for, without opening Free Now and counting rows.
  const totals = floorRooms.reduce((acc, room) => {
    const counts = getRoomStatusCounts(room);
    acc.free += counts.free || 0;
    acc.inuse += counts.inuse || 0;
    acc.not_available += counts.not_available || 0;
    return acc;
  }, { free: 0, inuse: 0, not_available: 0 });
  const floorSummary = `<div class="floor-status-summary">
    <span class="rstatus-pill avail">${totals.free} Free</span>
    <span class="rstatus-pill inuse">${totals.inuse} In Use</span>
    ${totals.not_available ? `<span class="rstatus-pill notavail">${totals.not_available} Not Available</span>` : ''}
  </div>`;

  return `<div class="corridor-wrap">
    <div class="corridor-top">
      <div class="corridor-label-group">
        <div class="corridor-label">${esc(currentFloor.name)}</div>
        <div class="corridor-sub">${floorRooms.length} rooms · ${floorRooms.reduce((total, room) => total + room.devices.length, 0)} devices</div>
        ${floorSummary}
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

export function renderRoom(room) {
  const roomTotals = {};
  room.devices.forEach(device => {
    roomTotals[device.type] = (roomTotals[device.type] || 0) + 1;
  });

  const statsRows = Object.entries(roomTotals).map(([type, count]) =>
    `<div class="srow"><span class="srow-k">${typeLabel[type]}</span><span class="srow-v">${count}</span></div>`
  ).join('');

  // Each row is tappable (opens the device panel) — on a phone this beats
  // hunting for a small tile on the canvas. Status changes happen in the
  // panel or on the tile itself; no extra controls cluttering the row.
  const deviceListItems = room.devices.filter(device => device.type !== 'bed').map(device => {
    const meta = getStatusMeta(device.id);
    return `<div class="dev-list-item clickable" data-action="goto-device" data-device-id="${device.id}" data-room="${room.id}" role="button" tabindex="0" title="Open ${esc(device.label)}">
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
        <div class="dev-list-type">Bed furniture</div>
      </div>
      ${isAdmin() ? `<button class="btn-mini danger admin-only" data-action="delete-device" data-device-id="${device.id}" data-room="${room.id}" title="Delete bed">Delete</button>` : ''}
    </div>
  `).join('');

  const devHTML = room.devices.map(device => deviceHTML(device, room)).join('');
  const floor = floors.find(floor => floor.id === room.floorId);

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
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8L10 13" stroke="#1a6bff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
        <div class="note-ttl-hint">${NOTE_TTL_HINT}</div>
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
let suppressDeviceClickUntil = 0;
let activePanelDeviceId = null;

function updateSelectedDeviceVisual({ reveal = false } = {}) {
  try {
    document.querySelectorAll('.device.is-selected').forEach(el => el.classList.remove('is-selected'));
    if (!activePanelDeviceId) return;
    const el = document.querySelector(`.device[data-device-id="${activePanelDeviceId}"]`);
    if (!el) return;
    el.classList.add('is-selected');
    // Arriving from a search result: the panel tells you *what* you picked,
    // but not *which tile on the canvas* it is. Scroll it into view and
    // replay the attention pulse so the answer is obvious.
    if (reveal) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      el.classList.remove('just-revealed');
      void el.offsetWidth; // restart the CSS animation
      el.classList.add('just-revealed');
    }
  } catch (e) { /* ignore */ }
}

function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function initDrag() {
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
  if (e.target && e.target.closest && e.target.closest('.dev-del-btn, .dev-quick-toggle')) return;
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
  // allow clicks on inner controls (delete button, quick status toggle) to pass through
  if (e.target && e.target.closest && e.target.closest('.dev-del-btn, .dev-quick-toggle')) return;
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

function onMouseMove(e) {
  if (!dragEl) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  if (!dragMoved && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
    dragMoved = true;
    dragEl.classList.add('dragging');
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

function onMouseUp() {
  const draggedDeviceId = dragMoved ? dragEl?.dataset.deviceId : null;
  if (dragEl) {
    dragEl.classList.remove('dragging');
    dragEl.style.transform = '';
    dragEl.style.transition = '';
    suppressDeviceClickUntil = Date.now() + 250;
    if (!dragMoved) {
      const type = dragEl.dataset.type;
      if (type !== 'bed') {
        openPanel(dragEl.dataset.deviceId, dragEl.dataset.room);
      }
    }
    dragEl = null;
    dragMoved = false;
  }
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerUp);
  // Only persist when a device actually moved — a plain click that just
  // opens the info panel shouldn't write to Firebase at all.
  if (draggedDeviceId) {
    try { saveDevicePosition(draggedDeviceId); } catch (e) { /* ignore */ }
  }
}

export function openPanel(devId, roomId) {
  const room = rooms.find(room => room.id === roomId);
  const device = room && room.devices.find(device => device.id === devId);
  if (!device) return;
  activePanelDeviceId = devId;
  panelOpenedStatus.set(devId, JSON.parse(JSON.stringify(getDeviceState(devId))));
  buildPanel(device, room);
  const panelBg = document.getElementById('panelBg');
  if (panelBg) panelBg.classList.add('open');
  updateSelectedDeviceVisual();
}

export function buildPanel(device, room) {
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

  const savedRows = saved.length ? saved.map((field, index) => `
    <div class="pkv"><span class="pkv-k">${esc(field.k)}</span><span class="pkv-v">${esc(field.v)}</span>${admin ? `<button class="cf-del pkv-del" data-action="delete-saved-field" data-device-id="${device.id}" data-room="${room.id}" data-index="${index}" title="Remove this field">×</button>` : ''}</div>`).join('') : '';

  const statusDetails = `
    <div class="psec">
      <div class="psec-title">Status</div>
      ${statusBadgeHTML(meta)}
      ${meta.detail ? `<div class="status-detail">${esc(meta.detail)}</div>` : ''}
      ${meta.key !== STATUS.FREE && st.since ? `<div class="status-since">${meta.key === STATUS.IN_USE ? 'In use' : 'Marked unavailable'} since ${esc(formatSinceLabel(st.since))} · auto-frees at midnight</div>` : ''}
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
      <div class="note-ttl-hint">${NOTE_TTL_HINT}</div>
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

export function startEditDevName(devId, roomId) {
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

export function saveDevName(devId, roomId) {
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

export function savePanel(devId, roomId) {
  const st = getDeviceState(devId);
  const room = rooms.find(room => room.id === roomId);
  if (!room) return;

  const toSave = st.customFields.filter(field => field.k.trim());
  st.savedFields = [...(st.savedFields || []), ...toSave];
  st.customFields = [];

  const statusSelect = document.getElementById(`statusSelect_${devId}`);
  // st.status was already live-updated by the dropdown's change handler
  // (instant preview, rebuilding the panel each time), so the real
  // "before" value is whatever it was when the panel was first opened.
  const prevStatus = panelOpenedStatus.has(devId) ? panelOpenedStatus.get(devId).status : st.status;
  panelOpenedStatus.delete(devId);
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
    try { saveDeviceState(devId); } catch (e) { /* ignore */ }
    if (st.status !== prevStatus) announceStatusChange(device, room, st.status);
  }
}

export function refreshDeviceVisual(devId) {
  const element = document.getElementById(`dev-${devId}`);
  if (!element) return;
  const meta = getStatusMeta(devId);
  const isFree = meta.key === STATUS.FREE;
  element.dataset.status = meta.key;
  const baseLabel = (element.getAttribute('aria-label') || '').split(' · ').slice(0, 2).join(' · ');
  element.setAttribute('aria-label', `${baseLabel || devId} · ${meta.label}`.trim());

  const helloShape = element.querySelector('.hello-shape');
  if (helloShape) {
    helloShape.classList.toggle('in-use', !isFree);
    helloShape.classList.toggle('available', isFree);
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

export function addField(devId) {
  const stateEntry = getDeviceState(devId);
  stateEntry.customFields.push({ k: '', v: '' });
  const room = rooms.find(room => room.devices.some(device => device.id === devId));
  if (room) {
    const device = room.devices.find(device => device.id === devId);
    buildPanel(device, room);
    markPanelDirty(devId);
  }
}

export function delField(devId, roomId, index) {
  const stateEntry = getDeviceState(devId);
  stateEntry.customFields.splice(index, 1);
  const room = rooms.find(room => room.id === roomId);
  if (room) {
    const device = room.devices.find(device => device.id === devId);
    buildPanel(device, room);
    markPanelDirty(devId);
  }
}

/** Deletes an already-saved custom field (saved fields used to be
 *  append-only — once merged into savedFields there was no way to ever
 *  remove one). Persists immediately; no dirty/save step. */
export function delSavedField(devId, roomId, index) {
  const stateEntry = getDeviceState(devId);
  if (!Array.isArray(stateEntry.savedFields) || !stateEntry.savedFields[index]) return;
  stateEntry.savedFields.splice(index, 1);
  const room = rooms.find(room => room.id === roomId);
  if (room) {
    const device = room.devices.find(device => device.id === devId);
    if (device) buildPanel(device, room);
  }
  try { saveDeviceState(devId); } catch (e) { /* ignore */ }
}

export function updateDeviceStatus(devId, roomId, status) {
  const st = getDeviceState(devId);
  const prevStatus = st.status;
  st.status = Object.values(STATUS).includes(status) ? status : STATUS.FREE;
  st.inUse = st.status === STATUS.IN_USE;
  if (st.status !== STATUS.IN_USE) st.employee = '';
  // Default the employee field to whoever is actually marking it in-use —
  // it stays editable (someone marking a room in-use on a colleague's
  // behalf can still type over it), this just removes the extra step and
  // the chance of a wrong/blank name for the common case.
  else if (!st.employee) st.employee = getAuthSession()?.username || '';
  if (st.status !== STATUS.NOT_AVAILABLE) st.notAvailableReason = '';
  // Drives both the "since HH:MM" display and the midnight auto-expiry sweep
  // (see startDeviceStatusExpiry() in data.js). Server-corrected clock, so
  // a wrong local clock can't produce a future/past stamp.
  if (st.status !== prevStatus) st.since = serverNow();
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

/** Immediately persists a status change and announces it. updateDeviceStatus()
 *  above is a local-only "live preview" — the panel's status dropdown relies
 *  on savePanel() to actually persist once the user clicks Save, so multiple
 *  field edits (status + employee + reason) commit together in one write.
 *  The quick-toggle tile control has no such deferred-save step, so it needs
 *  to persist and broadcast right away, same as savePanel() does. */
export function commitDeviceStatus(devId, roomId, status) {
  const room = rooms.find(room => room.id === roomId);
  const device = room && room.devices.find(device => device.id === devId);
  const st = getDeviceState(devId);
  const prevStatus = st.status;
  updateDeviceStatus(devId, roomId, status);
  clearPanelDirty(devId);
  try { saveDeviceState(devId); } catch (e) { /* ignore */ }
  // If this device's panel happens to be open, its "last saved" baseline
  // just moved — refresh the snapshot so a later Save/close compares
  // against what was actually persisted here.
  if (panelOpenedStatus.has(devId)) {
    panelOpenedStatus.set(devId, JSON.parse(JSON.stringify(st)));
  }
  if (device && st.status !== prevStatus) announceStatusChange(device, room, st.status);
}

export function updateEmployee(devId, roomId, value) {
  const st = getDeviceState(devId);
  st.employee = value.trim();
  refreshDeviceVisual(devId);
  markPanelDirty(devId);
}

export function updateUnavailableReason(devId, roomId, value) {
  const st = getDeviceState(devId);
  st.notAvailableReason = value.trim();
  refreshDeviceVisual(devId);
  markPanelDirty(devId);
}

export function rebuildPanelForDevice(devId, roomId) {
  const room = rooms.find(room => room.id === roomId);
  const device = room && room.devices.find(device => device.id === devId);
  if (device) buildPanel(device, room);
}

export function closePanel() {
  const panelBg = document.getElementById('panelBg');
  if (panelBg) panelBg.classList.remove('open');
  if (activePanelDeviceId) {
    const devId = activePanelDeviceId;
    const snapshot = panelOpenedStatus.get(devId);
    // Closing without saving: roll back the dropdown's live preview (and any
    // other unsaved panel edits) to the last-saved values, otherwise the
    // tiles keep showing a status that never reached the server and a later
    // remote sync would silently "revert" it in front of the user.
    if (snapshot && dirtyPanels.has(devId)) {
      const st = getDeviceState(devId);
      st.status = snapshot.status;
      st.inUse = snapshot.inUse;
      st.employee = snapshot.employee;
      st.notAvailableReason = snapshot.notAvailableReason;
      st.since = snapshot.since;
      st.customFields = [];
      clearPanelDirty(devId);
      if (state.currentRoom) render();
      else refreshDeviceVisual(devId);
    }
    panelOpenedStatus.delete(devId);
  }
  activePanelDeviceId = null;
  updateSelectedDeviceVisual();
}

// ─────────────────────────────────────────────────────────────────
//  Auth screen rendering — login, first-run setup, user management
// ─────────────────────────────────────────────────────────────────

export function renderLogin(errorMsg = '') {
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
          <div class="pw-wrap">
            <input class="field-input" id="loginPass" type="password" placeholder="Enter your password" autocomplete="current-password" />
            <button class="pw-toggle" type="button" tabindex="-1" data-action="toggle-password" data-target="loginPass">Show</button>
          </div>
        </div>
        <button class="btn-primary auth-submit-btn" data-action="do-login" type="button">Sign In</button>
      </div>
    </div>
  `;
  setTimeout(() => document.getElementById('loginUser')?.focus(), 60);
}

export function renderSetup(errorMsg = '') {
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
          <div class="pw-wrap">
            <input class="field-input" id="setupPass" type="password" placeholder="Choose a password (min 6 characters)" autocomplete="new-password" />
            <button class="pw-toggle" type="button" tabindex="-1" data-action="toggle-password" data-target="setupPass">Show</button>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label" for="setupPass2">Confirm Password</label>
          <div class="pw-wrap">
            <input class="field-input" id="setupPass2" type="password" placeholder="Repeat your password" autocomplete="new-password" />
            <button class="pw-toggle" type="button" tabindex="-1" data-action="toggle-password" data-target="setupPass2">Show</button>
          </div>
        </div>
        <button class="btn-primary auth-submit-btn" data-action="do-setup" type="button">Create Account & Sign In</button>
      </div>
    </div>
  `;
  setTimeout(() => document.getElementById('setupUser')?.focus(), 60);
}

export function renderUserMgmtContent() {
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
        <div class="pw-wrap">
          <input class="field-input" id="newUserPass" type="password" placeholder="Minimum 6 characters" />
          <button class="pw-toggle" type="button" tabindex="-1" data-action="toggle-password" data-target="newUserPass">Show</button>
        </div>
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

export function render() {
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
