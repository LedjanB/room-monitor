import {
  login,
  logout,
  createUser,
  removeUser,
  setUserRole,
  getAuthUsers,
  getAuthSession,
  isAdminSession,
  subscribeOwnProfile,
} from './hospital_room_monitor_v9.auth.js';
import {
  state,
  floors,
  rooms,
  STATUS,
  devState,
  getAllSNs,
  normalizeDevState,
  typeDefaults,
  initDevState,
  uid,
  noteUid,
  saveState,
  saveDeviceState,
  saveDevicePosition,
  saveLocalUIState,
  positions,
  getDeviceState,
  esc,
  loadRemoteState,
  subscribeRemoteState,
  broadcastActivity,
  startDeviceStatusExpiry,
  subscribeNotifications,
  getUnreadNotificationCount,
  markNotificationsSeen as persistNotificationsSeen,
  setSyncErrorHandler,
  setConnectionHandler,
  serverNow,
  deviceCount,
  getRoomStatusCounts,
  trash,
  addToTrash,
  getTrashList,
  pruneTrash,
} from './hospital_room_monitor_v9.data.js';
import {
  render,
  renderLogin,
  renderSetup,
  renderUserMgmtContent,
  renderNotificationsList,
  handleSearch,
  clearSearch,
  goToDevice,
  switchFloor,
  openPanel,
  closePanel,
  addField,
  delField,
  delSavedField,
  savePanel,
  startEditDevName,
  saveDevName,
  applyTheme,
  cycleTheme,
  getThemePref,
  setThemePref,
  startEditDevSn,
  refreshDeviceVisual,
  initDrag,
  updateDeviceStatus,
  commitDeviceStatus,
  updateEmployee,
  updateUnavailableReason,
  rebuildPanelForDevice,
  markPanelDirty,
  canDeleteNote,
  setEditingNote,
  getEditingNote,
} from './hospital_room_monitor_v9.render.js';

let addDevRoomId = null;
let pendingConfirm = null;
let draggedRoomId = null;

function getDeviceId(target) {
  return target?.dataset?.deviceId || target?.dataset?.dev || target?.dataset?.id || '';
}

// Was reading a `state.currentRole` field that always defaulted to 'admin'
// and was never updated from the real logged-in role — every one of these
// checks was permanently a no-op. Delegates to the real session role now.
function isAdminRole() {
  return isAdminSession();
}

const MAX_VISIBLE_TOASTS = 4;

function showToast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  while (stack.children.length >= MAX_VISIBLE_TOASTS) {
    stack.firstElementChild.remove(); // a burst of activity shouldn't pile up forever
  }
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

// ── Settings ────────────────────────────────────────────────────────
const POPUPS_KEY = 'hrm-popups';
function popupsEnabled() {
  try { return localStorage.getItem(POPUPS_KEY) !== 'off'; } catch (e) { return true; }
}

function timeAgo(ts) {
  const mins = Math.max(0, Math.round((serverNow() - (Number(ts) || 0)) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function renderSettings() {
  const body = document.getElementById('settingsBody');
  if (!body) return;
  const theme = getThemePref();
  const seg = (action, value, current, label) =>
    `<button type="button" class="seg-btn${value === current ? ' is-on' : ''}" role="radio" aria-checked="${value === current}" data-action="${action}" data-value="${value}">${label}</button>`;

  let trashSection = '';
  if (isAdminRole()) {
    pruneTrash();
    const items = getTrashList();
    const kindLabel = { floor: 'Floor', room: 'Room', device: 'Device' };
    trashSection = `
      <section class="set-sec">
        <h3 class="set-title">Recently deleted</h3>
        <p class="set-help lead">Deleted floors, rooms and devices stay here for 30 days. Restoring puts them back with their devices, positions and notes.</p>
        ${items.length ? `<ul class="trash-list">${items.map(item => {
          const where = item.kind === 'room' ? (item.floorName ? ` · from ${esc(item.floorName)}` : '')
            : item.kind === 'device' ? (item.roomName ? ` · from ${esc(item.roomName)}` : '')
            : item.rooms?.length ? ` · ${item.rooms.length} rooms` : '';
          return `<li class="trash-item">
            <div class="trash-main"><span class="trash-kind">${kindLabel[item.kind] || 'Item'}</span><span class="trash-name">${esc(item.name)}</span>
              <span class="trash-meta">Deleted ${esc(timeAgo(item.deletedAt))}${item.deletedBy ? ` by ${esc(item.deletedBy)}` : ''}${where}</span></div>
            <button class="btn-mini primary" data-action="restore-trash" data-trash-id="${esc(item.id)}">Restore</button>
          </li>`;
        }).join('')}</ul>` : '<div class="set-empty">Nothing deleted in the last 30 days.</div>'}
      </section>`;
  }

  body.innerHTML = `
    <section class="set-sec">
      <h3 class="set-title">Theme</h3>
      <div class="seg" role="radiogroup" aria-label="Theme">
        ${seg('set-theme', 'system', theme, 'Match my computer')}${seg('set-theme', 'light', theme, 'Light')}${seg('set-theme', 'dark', theme, 'Dark')}
      </div>
    </section>
    <section class="set-sec">
      <h3 class="set-title">Popups</h3>
      <label class="set-toggle">
        <input type="checkbox" data-action="toggle-popups" ${popupsEnabled() ? 'checked' : ''} />
        <span>Show a popup when a teammate changes a status or adds a note</span>
      </label>
      <p class="set-help">The bell keeps the full list either way. Only affects this browser.</p>
    </section>
    ${trashSection}`;
}

function refreshSettingsIfOpen() {
  if (document.getElementById('settingsModal')?.classList.contains('open')) renderSettings();
}

/** Toast with an Undo button (stays longer, and is clickable). */
function showUndoToast(message, trashId) {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  while (stack.children.length >= MAX_VISIBLE_TOASTS) stack.firstElementChild.remove();
  const toast = document.createElement('div');
  toast.className = 'toast success toast-undo';
  const text = document.createElement('span');
  text.textContent = message;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toast-undo-btn';
  btn.textContent = 'Undo';
  btn.addEventListener('click', () => { toast.remove(); restoreFromTrash(trashId); });
  toast.append(text, btn);
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .18s';
    setTimeout(() => toast.remove(), 220);
  }, 9000);
}

function snapshotDevices(deviceList) {
  const ds = {};
  const ps = {};
  deviceList.forEach(d => {
    if (devState[d.id]) ds[d.id] = devState[d.id];
    if (positions[d.id]) ps[d.id] = positions[d.id];
  });
  return { devState: ds, positions: ps };
}

function deletedBy() {
  return getAuthSession()?.username || '';
}

function restoreDeviceData(entry) {
  Object.entries(entry.devState || {}).forEach(([id, value]) => { devState[id] = normalizeDevState(value); });
  Object.entries(entry.positions || {}).forEach(([id, value]) => { positions[id] = value; });
}

function fixRoomArrays(room) {
  // RTDB drops empty arrays, so a stored room may come back without them.
  return { ...room, devices: Array.isArray(room.devices) ? room.devices : [], notes: Array.isArray(room.notes) ? room.notes : [] };
}

function uniqueName(name, taken) {
  const lower = new Set(taken.map(n => String(n || '').toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  let n = 2;
  while (lower.has(`${name} (${n})`.toLowerCase())) n += 1;
  return `${name} (${n})`;
}

/** Puts a deleted floor, room or device back. Returns an error message or ''. */
function restoreFromTrash(trashId) {
  if (!isAdminRole()) return 'Only admins can restore.';
  const entry = trash[trashId];
  if (!entry) { showToast('That item is no longer in Recently deleted.', 'error'); return 'missing'; }

  if (entry.kind === 'floor') {
    const floor = { ...entry.floor, name: uniqueName(entry.floor.name, floors.map(f => f.name)) };
    if (floors.some(f => f.id === floor.id)) floor.id = uid('floor');
    floors.splice(Math.min(entry.floorIndex ?? floors.length, floors.length), 0, floor);
    (entry.rooms || []).forEach(r => rooms.push({ ...fixRoomArrays(r), floorId: floor.id }));
    restoreDeviceData(entry);
    state.currentFloorId = floor.id;
    state.currentRoom = null;
  } else if (entry.kind === 'room') {
    const floorId = floors.some(f => f.id === entry.floorId) ? entry.floorId : state.currentFloorId;
    const room = fixRoomArrays(entry.room);
    room.floorId = floorId;
    room.name = uniqueName(room.name, rooms.filter(r => r.floorId === floorId).map(r => r.name));
    const pos = room.pos;
    room.pos = 9999;
    rooms.push(room);
    moveRoomToSlot(room.id, room.side, pos);
    restoreDeviceData(entry);
    state.currentFloorId = floorId;
  } else if (entry.kind === 'device') {
    const room = rooms.find(r => r.id === entry.roomId);
    if (!room) {
      showToast(`${entry.roomName || 'Its room'} no longer exists. Restore the room first.`, 'error');
      return 'no-room';
    }
    const device = { ...entry.device };
    if (device.sn && getAllSNs().has(String(device.sn).toUpperCase())) {
      showToast(`Another device already uses serial ${device.sn}.`, 'error');
      return 'sn';
    }
    room.devices.push(device);
    restoreDeviceData(entry);
  }

  delete trash[trashId];
  render();
  initSearchFilters();
  saveState();
  setTimeout(initDrag, 40);
  refreshSettingsIfOpen();
  showToast(`${entry.name} restored.`);
  return '';
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

function saveDevSn(devId, roomId) {
  if (!isAdminRole()) return;
  const room = rooms.find(room => room.id === roomId);
  const device = room && room.devices.find(device => device.id === devId);
  if (!device) return;
  const input = document.getElementById(`snInput_${devId}`);
  if (!input) return;
  const next = normalizeText(input.value).toUpperCase();
  // Unchanged: just close the editor. Checked before validation, otherwise
  // the device's own serial would trip the "already exists" check.
  if (next === String(device.sn || '').toUpperCase()) {
    rebuildPanelForDevice(devId, roomId);
    return;
  }
  const result = validateSerialNumber(next);
  if (!result.valid) {
    showToast(result.message, 'error');
    input.focus();
    return;
  }
  device.sn = result.value;
  refreshDeviceVisual(devId);
  rebuildPanelForDevice(devId, roomId);
  saveState();
  showToast('Serial number saved.');
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

/** A free-ish spot for a newly added device: step diagonally across the
 *  canvas so consecutive additions don't land on top of one another, and
 *  keep the whole box inside the room. */
function spawnPosition(room, def) {
  const step = room.devices.length;
  const maxX = Math.max(0, 100 - (def.w || 12));
  const maxY = Math.max(0, 100 - (def.h || 12));
  const x = Math.min(maxX, 12 + (step % 6) * 11);
  const y = Math.min(maxY, 10 + (Math.floor(step / 6) % 5) * 13);
  return { x, y };
}

/** Beds have no serial number, so the SN field is hidden (and skipped by
 *  the validator) whenever "Bed" is the selected type. */
function syncAddDevTypeUI() {
  const typeSelect = document.getElementById('addDevType');
  const group = document.getElementById('addDevSNGroup');
  if (!group) return;
  const isBed = typeSelect?.value === 'bed';
  group.hidden = isBed;
  if (isBed) {
    const snInput = document.getElementById('addDevSN');
    if (snInput) snInput.value = '';
    clearError(snInput, document.getElementById('addDevSNErr'));
  }
}

export function openAddDevModal(roomId) {
  if (!isAdminRole()) return;
  addDevRoomId = roomId;
  const nameInput = document.getElementById('addDevName');
  const snInput = document.getElementById('addDevSN');
  const errorEl = document.getElementById('addDevSNErr');

  if (nameInput) nameInput.value = '';
  if (snInput) snInput.value = '';
  clearError(snInput, errorEl);
  syncAddDevTypeUI();

  const modal = document.getElementById('addDevModal');
  if (modal) modal.classList.add('open');
}

export function confirmAddDevice() {
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

  // Beds are furniture, not tracked equipment — no serial number to
  // validate, and the SN field is hidden for them (see syncAddDevTypeUI).
  let sn = '';
  if (type !== 'bed') {
    const snResult = validateSerialNumber(snInput?.value);
    if (!snResult.valid) {
      markError(snInput, errorEl, snResult.message);
      return;
    }
    sn = snResult.value;
  }

  const room = rooms.find(room => room.id === addDevRoomId);
  if (!room) {
    showToast('Room was not found.', 'error');
    return;
  }

  const id = uid('dev');
  const def = typeDefaults[type] || { w: 12, h: 12 };
  // Cascade each new device instead of dropping every one on the same spot —
  // adding three in a row used to stack them exactly on top of each other,
  // so they looked like one device until you dragged them apart.
  const spot = spawnPosition(room, def);
  const device = {
    id,
    type,
    label: name,
    ...(sn ? { sn } : {}),
    x: spot.x,
    y: spot.y,
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

export function addBedToRoom(roomId) {
  if (!isAdminRole()) return;
  const room = rooms.find(room => room.id === roomId);
  if (!room) {
    showToast('Room was not found.', 'error');
    return;
  }

  const bedCount = room.devices.filter(device => device.type === 'bed').length;
  const id = uid('bed');
  const def = typeDefaults.bed || { w: 20, h: 52 };

  const xOptions = [35, 8, 68, 22, 52];
  const yOptions = [36, 34, 34, 38, 38];
  const slot = bedCount % xOptions.length;
  // No serial number: a bed is room furniture, not tracked equipment —
  // it has no status, no detail panel and nothing to look up by SN.
  const device = {
    id,
    type: 'bed',
    label: `Bed ${bedCount + 1}`,
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

export function deleteDevice(devId, roomId, event) {
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
      const trashId = addToTrash({
        kind: 'device', name: device.label, deletedBy: deletedBy(),
        roomId: room.id, roomName: room.name, device, ...snapshotDevices([device]),
      });
      room.devices.splice(index, 1);
      cleanupDeviceData(devId);
      closePanel();
      render();
      saveState();
      showUndoToast(`${device.label} deleted.`, trashId);
      setTimeout(initDrag, 40);
    },
  });
}

function floorSideRooms(side) {
  return rooms
    .filter(room => room.floorId === state.currentFloorId && room.side === side)
    .sort((a, b) => a.pos - b.pos);
}

/** Fills the "Where" dropdown for the chosen side: at the top, after each
 *  room, defaulting to the given slot (1-based) or the end. */
function fillAddRoomWhere(side, slotIndex) {
  const select = document.getElementById('addRoomPos');
  const sideInput = document.getElementById('addRoomSide');
  if (sideInput) sideInput.value = side;
  document.querySelectorAll('[data-action="add-room-side"]').forEach(btn => {
    const on = btn.dataset.side === side;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-checked', String(on));
  });
  if (!select) return;
  const list = floorSideRooms(side);
  const options = [`<option value="1">At the start of the ${side} side</option>`]
    .concat(list.map((room, index) => `<option value="${index + 2}">After ${esc(room.name)}</option>`));
  select.innerHTML = options.join('');
  const wanted = Math.min(Math.max(Number.parseInt(slotIndex, 10) || list.length + 1, 1), list.length + 1);
  select.value = String(wanted);
}

export function openAddRoomModal(side = 'left', slotIndex = null) {
  if (!isAdminRole()) return;
  const nameInput = document.getElementById('addRoomName');
  if (nameInput) {
    nameInput.value = '';
    nameInput.classList.remove('error');
  }
  fillAddRoomWhere(side === 'right' ? 'right' : 'left', slotIndex);
  const modal = document.getElementById('addRoomModal');
  // Custom layouts place the room in a free spot; side/position don't apply.
  const free = floors.find(f => f.id === state.currentFloorId)?.layout === 'free';
  modal?.classList.toggle('free-layout', free);
  if (modal) modal.classList.add('open');
  setTimeout(() => nameInput?.focus(), 30);
}

/** Adds a room on the current floor at a 1-based spot on one side.
 *  Returns the error message, or '' on success. */
function addRoomAt(name, side, slotIndex) {
  const nameError = validateName(name, 'Room name');
  if (nameError) return nameError;
  const nameLower = name.toLowerCase();
  if (rooms.some(r => r.floorId === state.currentFloorId && r.name?.toLowerCase() === nameLower)) {
    return 'A room with that name already exists on this floor.';
  }
  const id = uid('room');
  const room = { id, floorId: state.currentFloorId, name, side, pos: 9999, devices: [], notes: [] };
  const floor = floors.find(f => f.id === state.currentFloorId);
  if (floor?.layout === 'free') room.box = freeSpotFor(floor);
  rooms.push(room);
  moveRoomToSlot(id, side, slotIndex || 9999);
  return '';
}

export function confirmAddRoom() {
  if (!isAdminRole()) return;
  const nameInput = document.getElementById('addRoomName');
  const side = document.getElementById('addRoomSide')?.value === 'right' ? 'right' : 'left';
  const slot = document.getElementById('addRoomPos')?.value;
  const name = normalizeText(nameInput?.value);
  nameInput?.classList.remove('error');
  const error = addRoomAt(name, side, slot);
  if (error) {
    markError(nameInput, null, error);
    return;
  }
  closeModal('addRoomModal');
  render();
  saveState();
  showToast(`${name} added.`);
}

export function openEditRoomModal(roomId) {
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

export function confirmEditRoom() {
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

export function deleteRoom(roomId) {
  if (!isAdminRole()) return;
  const room = rooms.find(room => room.id === roomId);
  if (!room) return;
  const deviceCount = room.devices.length;
  const noteCount = Array.isArray(room.notes) ? room.notes.length : 0;

  openConfirm({
    title: 'Delete Room',
    message: `Delete "${room.name}"?\n\nThis room contains ${deviceCount} device${deviceCount === 1 ? '' : 's'} and ${noteCount} note${noteCount === 1 ? '' : 's'}. You can restore it from Settings → Recently deleted for 30 days.`,
    confirmText: 'Delete Room',
    danger: true,
    onConfirm: () => {
      const trashId = addToTrash({
        kind: 'room', name: room.name, deletedBy: deletedBy(),
        floorId: room.floorId, floorName: floors.find(f => f.id === room.floorId)?.name || '',
        room, ...snapshotDevices(room.devices),
      });
      cleanupRoomData(room);
      const index = rooms.findIndex(r => r.id === roomId);
      if (index !== -1) rooms.splice(index, 1);
      state.currentRoom = null;
      if (state.layoutSelected === roomId) { state.layoutSelected = null; state.layoutRenaming = false; }
      render();
      saveState();
      if (document.getElementById('editFloorModal')?.classList.contains('open')) renderFloorManager();
      showUndoToast(`${room.name} deleted.`, trashId);
    },
  });
}

export function openAddFloorModal() {
  if (!isAdminRole()) return;
  const nameInput = document.getElementById('addFloorName');
  if (nameInput) {
    nameInput.value = '';
    nameInput.classList.remove('error');
  }
  const modal = document.getElementById('addFloorModal');
  if (modal) modal.classList.add('open');
}

export function confirmAddFloor() {
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

export function openEditFloorModal(floorId) {
  if (!isAdminRole()) return;
  const floor = floors.find(floor => floor.id === floorId);
  if (!floor) return;
  state.editingFloorId = floorId;
  const input = document.getElementById('editFloorName');
  if (input) {
    input.value = floor.name;
    input.classList.remove('error');
  }
  floorMgrAdding = null;
  floorMgrRenaming = null;
  renderFloorManager();
  const modal = document.getElementById('editFloorModal');
  if (modal) modal.classList.add('open');
}

let floorMgrAdding = null;   // 'left' | 'right' while the inline add row is open
let floorMgrRenaming = null; // room id being renamed inline

const fmIcon = {
  up: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 8.5L7 5l3.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 5.5L7 9l3.5-3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  left: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8.5 3.5L5 7l3.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5.5 3.5L9 7l-3.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M9 2l3 3-8 8H1v-3l8-8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 4h9M5.5 4V2.5h3V4M3.5 4l.6 7.5h5.8l.6-7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function renderFloorManager() {
  const statsEl = document.getElementById('floorMgrStats');
  const roomsEl = document.getElementById('floorMgrRooms');
  if (!roomsEl) return;
  const floorId = state.editingFloorId;
  const floorObj = floors.find(f => f.id === floorId);
  const isFree = floorObj?.layout === 'free';
  const segEl = document.getElementById('floorLayoutSeg');
  const helpEl = document.getElementById('floorLayoutHelp');
  if (segEl) {
    const opt = (value, label) => `<button type="button" class="seg-btn${(isFree ? 'free' : 'corridor') === value ? ' is-on' : ''}" role="radio" aria-checked="${(isFree ? 'free' : 'corridor') === value}" data-action="set-floor-layout" data-value="${value}">${label}</button>`;
    segEl.innerHTML = opt('corridor', 'Straight corridor') + opt('free', 'Floor plan');
  }
  if (helpEl) {
    helpEl.textContent = isFree
      ? 'Rooms drawn like a real floor plan. Close this and click Edit layout on the floor to move, resize or draw rooms.'
      : 'Rooms on two sides of one straight corridor. Switch to Floor plan for turns, corners or any shape; it starts from this layout.';
  }
  const floorRooms = rooms.filter(room => room.floorId === floorId);
  const devices = floorRooms.reduce((sum, room) => sum + deviceCount(room), 0);
  const counts = floorRooms.reduce((acc, room) => {
    const c = getRoomStatusCounts(room);
    acc.inuse += c.inuse || 0;
    acc.na += c.not_available || 0;
    return acc;
  }, { inuse: 0, na: 0 });
  if (statsEl) {
    statsEl.innerHTML = `<span><b>${floorRooms.length}</b> rooms</span><span><b>${devices}</b> devices</span><span><b>${counts.inuse}</b> in use</span>${counts.na ? `<span><b>${counts.na}</b> not available</span>` : ''}`;
  }

  const column = side => {
    const list = rooms.filter(room => room.floorId === floorId && room.side === side).sort((a, b) => a.pos - b.pos);
    const other = side === 'left' ? 'right' : 'left';
    const rows = list.map((room, index) => {
      const n = deviceCount(room);
      const nameCell = floorMgrRenaming === room.id
        ? `<input class="field-input fm-rename" id="fmRename_${room.id}" value="${esc(room.name)}" data-action="fm-rename-save" data-room="${room.id}" />
           <button class="btn-mini primary" data-action="fm-rename-save" data-room="${room.id}">Save</button>`
        : `<span class="fm-name">${esc(room.name)}</span><span class="fm-meta">${n} ${n === 1 ? 'device' : 'devices'}</span>`;
      return `<li class="fm-row">
        <div class="fm-main">${nameCell}</div>
        <div class="fm-tools">
          <button class="fm-btn" data-action="fm-move" data-room="${room.id}" data-dir="-1" title="Move up" aria-label="Move ${esc(room.name)} up" ${index === 0 ? 'disabled' : ''}>${fmIcon.up}</button>
          <button class="fm-btn" data-action="fm-move" data-room="${room.id}" data-dir="1" title="Move down" aria-label="Move ${esc(room.name)} down" ${index === list.length - 1 ? 'disabled' : ''}>${fmIcon.down}</button>
          <button class="fm-btn" data-action="fm-switch" data-room="${room.id}" title="Move to the ${other} side" aria-label="Move ${esc(room.name)} to the ${other} side">${side === 'left' ? fmIcon.right : fmIcon.left}</button>
          <button class="fm-btn" data-action="fm-rename" data-room="${room.id}" title="Rename" aria-label="Rename ${esc(room.name)}">${fmIcon.edit}</button>
          <button class="fm-btn danger" data-action="fm-delete" data-room="${room.id}" title="Delete room" aria-label="Delete ${esc(room.name)}">${fmIcon.trash}</button>
        </div>
      </li>`;
    }).join('');
    const addRow = floorMgrAdding === side
      ? `<div class="fm-add-row"><input class="field-input" id="fmAddName_${side}" placeholder="Room name" data-action="fm-add-save" data-side="${side}" /><button class="btn-mini primary" data-action="fm-add-save" data-side="${side}">Add</button><button class="btn-mini" data-action="fm-add-cancel">Cancel</button></div>`
      : `<button class="fm-add" data-action="fm-add" data-side="${side}">+ Add room on the ${side}</button>`;
    return `<div class="fm-col">
      <div class="fm-col-title">${side === 'left' ? 'Left side' : 'Right side'}</div>
      <ol class="fm-list">${rows || '<li class="fm-empty">No rooms yet</li>'}</ol>
      ${addRow}
    </div>`;
  };

  if (isFree) {
    const list = rooms.filter(room => room.floorId === floorId).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    const rows = list.map(room => {
      const n = deviceCount(room);
      const nameCell = floorMgrRenaming === room.id
        ? `<input class="field-input fm-rename" id="fmRename_${room.id}" value="${esc(room.name)}" data-action="fm-rename-save" data-room="${room.id}" />
           <button class="btn-mini primary" data-action="fm-rename-save" data-room="${room.id}">Save</button>`
        : `<span class="fm-name">${esc(room.name)}</span><span class="fm-meta">${n} ${n === 1 ? 'device' : 'devices'}</span>`;
      return `<li class="fm-row"><div class="fm-main">${nameCell}</div><div class="fm-tools">
        <button class="fm-btn" data-action="fm-rename" data-room="${room.id}" title="Rename" aria-label="Rename ${esc(room.name)}">${fmIcon.edit}</button>
        <button class="fm-btn danger" data-action="fm-delete" data-room="${room.id}" title="Delete room" aria-label="Delete ${esc(room.name)}">${fmIcon.trash}</button>
      </div></li>`;
    }).join('');
    const addRow = floorMgrAdding
      ? `<div class="fm-add-row"><input class="field-input" id="fmAddName_left" placeholder="Room name" data-action="fm-add-save" data-side="left" /><button class="btn-mini primary" data-action="fm-add-save" data-side="left">Add</button><button class="btn-mini" data-action="fm-add-cancel">Cancel</button></div>`
      : `<button class="fm-add" data-action="fm-add" data-side="left">+ Add room</button>`;
    roomsEl.innerHTML = `<div class="fm-col"><div class="fm-col-title">Rooms</div><ol class="fm-list fm-grid">${rows || '<li class="fm-empty">No rooms yet</li>'}</ol>${addRow}</div>`;
  } else {
    roomsEl.innerHTML = `<div class="fm-corridor">${column('left')}<div class="fm-hall" aria-hidden="true"></div>${column('right')}</div>
    <div class="fm-hint">Top of each list is the start of the corridor. You can also drag rooms on the floor view.</div>`;
  }

  if (floorMgrAdding) setTimeout(() => document.getElementById(`fmAddName_${floorMgrAdding}`)?.focus(), 20);
  if (floorMgrRenaming) setTimeout(() => { const el = document.getElementById(`fmRename_${floorMgrRenaming}`); el?.focus(); el?.select(); }, 20);
}

// ── Custom floor layout (floor-plan map) ────────────────────────────
// Rooms are rectangles on a floor (room.box, % of the canvas). The corridor
// is simply the floor left between them. Admins edit with Edit layout:
// click to select, drag to move, handles to resize, drag on empty floor to
// draw a new room. Everything snaps to a 1% grid and to other rooms' walls.
const FMAP_MIN = 5;      // smallest room, % of canvas
const FMAP_SNAP = 1.2;   // wall-to-wall snap distance, %

function ffClamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

/** Snaps value v to the nearest of `targets` within FMAP_SNAP, else to the grid. */
function snapTo(v, targets) {
  let best = null;
  targets.forEach(t => { if (Math.abs(t - v) <= FMAP_SNAP && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t; });
  return best !== null ? best : Math.round(v);
}

function wallTargets(floorId, exceptId) {
  const xs = [0, 100];
  const ys = [0, 100];
  rooms.forEach(r => {
    if (r.floorId !== floorId || r.id === exceptId || !r.box) return;
    xs.push(r.box.x, r.box.x + r.box.w);
    ys.push(r.box.y, r.box.y + r.box.h);
  });
  return { xs, ys };
}

/** First layout for a floor switched to Custom: left-side rooms along the
 *  top wall, right-side rooms along the bottom, the corridor between them.
 *  Same order as the straight view, so it matches what people know. */
function convertFloorToFree(floor) {
  const list = side => rooms.filter(r => r.floorId === floor.id && r.side === side).sort((a, b) => a.pos - b.pos);
  const top = list('left');
  const bottom = list('right');
  const cols = Math.max(top.length, bottom.length, 1);
  const w = 100 / cols;
  const roomH = 38;
  const place = (room, i, y) => {
    if (room.box) return; // keep a layout made earlier
    room.box = { x: Number((i * w).toFixed(2)), y, w: Number(w.toFixed(2)), h: roomH };
  };
  top.forEach((room, i) => place(room, i, 0));
  bottom.forEach((room, i) => place(room, i, 100 - roomH));
  if (!Array.isArray(floor.corridors) || !floor.corridors.length) {
    floor.corridors = [{ id: uid('cor'), x: 0, y: roomH, w: 100, h: 100 - roomH * 2 }];
  }
  floor.aspect = Number(Math.min(0.9, Math.max(0.42, 1.6 / cols + 0.3)).toFixed(2));
  floor.layout = 'free';
}

function setFloorLayout(floorId, layout) {
  if (!isAdminRole()) return;
  const floor = floors.find(f => f.id === floorId);
  if (!floor || (floor.layout || 'corridor') === layout) return;
  if (layout === 'free') convertFloorToFree(floor);
  else floor.layout = 'corridor'; // boxes are kept for switching back
  if (state.layoutEditing === floorId) state.layoutEditing = null;
  render();
  saveState();
  renderFloorManager();
  showToast(layout === 'free' ? 'Floor plan layout on. Click Edit layout on the floor to arrange rooms.' : 'Straight corridor layout on.');
}

/** Empty spot for a new room on a floor-plan floor. */
function freeSpotFor(floor, w = 16, h = 26) {
  const boxes = rooms.filter(r => r.floorId === floor.id && r.box).map(r => r.box);
  const hits = (x, y) => boxes.some(b => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y);
  for (let y = 0; y + h <= 100; y += 2) {
    for (let x = 0; x + w <= 100; x += 2) {
      if (!hits(x, y)) return { x, y, w, h };
    }
  }
  return { x: 42, y: 37, w, h };
}

function nextRoomName(floorId) {
  const taken = new Set(rooms.filter(r => r.floorId === floorId).map(r => String(r.name).toLowerCase()));
  let n = rooms.filter(r => r.floorId === floorId).length + 1;
  while (taken.has(`room ${n}`)) n += 1;
  return `Room ${n}`;
}

let ffDrag = null;

// Straight corridor: drag the handle to change the corridor's width.
let corrDrag = null;
function corrPointerDown(event) {
  const handle = event.target.closest?.('[data-corr-handle]');
  if (!handle || !isAdminRole()) return;
  event.preventDefault();
  const plan = handle.closest('.floor-plan');
  const floor = floors.find(f => f.id === state.currentFloorId);
  if (!plan || !floor) return;
  corrDrag = { plan, floor, startX: event.clientX, startW: Number(floor.corridorWidth) || 60 };
  handle.classList.add('dragging');
  try { handle.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
}
function corrPointerMove(event) {
  if (!corrDrag) return;
  // The corridor sits in the middle, so it grows on both sides: 2x the mouse move.
  const w = Math.round(ffClamp(corrDrag.startW + (event.clientX - corrDrag.startX) * 2, 24, 420));
  corrDrag.w = w;
  corrDrag.plan.style.setProperty('--corr-w', `${w}px`);
}
function corrPointerUp() {
  if (!corrDrag) return;
  const { floor, w } = corrDrag;
  corrDrag = null;
  document.querySelector('[data-corr-handle]')?.classList.remove('dragging');
  if (w && w !== floor.corridorWidth) {
    floor.corridorWidth = w;
    saveState();
  }
}

function ffPointerDown(event) {
  if (event.button !== 0) return;
  const canvas = event.target.closest?.('.fmap.editing');
  if (!canvas || !isAdminRole()) return;
  if (event.target.closest('.fmap-pop')) return;
  const floor = floors.find(f => f.id === canvas.dataset.floor);
  if (!floor) return;
  const rect = canvas.getBoundingClientRect();
  const at = e => ({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 });
  const roomEl = event.target.closest('.fmap-room');
  event.preventDefault();

  const corEl = !roomEl && event.target.closest('.fmap-corr');
  if (corEl) {
    const cor = (floor.corridors || []).find(c => c.id === corEl.dataset.ffCid);
    if (!cor) return;
    const handle = event.target.closest('[data-ff-handle]')?.dataset.ffHandle || null;
    ffDrag = { mode: handle ? 'cresize' : 'cmove', handle, cor, floor, rect, at, start: at(event), orig: { ...cor }, el: corEl, moved: false };
    if (handle) ffDrag.walls = handle.split('').map(side => corridorWall(cor, side));
    corEl.classList.add('dragging');
    return;
  }

  if (!roomEl) {
    // Empty floor: draw a new room.
    const start = at(event);
    ffDrag = { mode: 'draw', floor, rect, at, start, cur: start, moved: false };
    state.layoutSelected = null;
    state.layoutRenaming = false;
    return;
  }
  const room = rooms.find(r => r.id === roomEl.dataset.ffId);
  if (!room) return;
  if (!room.box) room.box = freeSpotFor(floor);
  const handle = event.target.closest('[data-ff-handle]')?.dataset.ffHandle || null;
  ffDrag = { mode: handle ? 'resize' : 'move', handle, room, floor, rect, at, start: at(event), orig: { ...room.box }, el: roomEl, moved: false };
  if (handle) ffDrag.walls = handle.split('').map(side => linkedWall(room, side));
  roomEl.classList.add('dragging');
  try { roomEl.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
}

function ffPointerMove(event) {
  if (!ffDrag) return;
  const p = ffDrag.at(event);
  const dx = p.x - ffDrag.start.x;
  const dy = p.y - ffDrag.start.y;
  if (Math.abs(dx) + Math.abs(dy) > 0.4) ffDrag.moved = true;
  if (!ffDrag.moved) return;

  if (ffDrag.mode === 'cmove') {
    const { orig, cor } = ffDrag;
    cor.x = ffClamp(Math.round(orig.x + dx), 0, 100 - orig.w);
    cor.y = ffClamp(Math.round(orig.y + dy), 0, 100 - orig.h);
    Object.assign(ffDrag.el.style, { left: `${cor.x}%`, top: `${cor.y}%` });
    const pop = document.querySelector('.fmap-pop'); if (pop) pop.hidden = true;
    return;
  }

  if (ffDrag.mode === 'cresize') {
    const { orig, cor } = ffDrag;
    const CMIN = 2;
    ffDrag.walls.forEach(w => {
      const horizontal = w.side === 'n' || w.side === 's';
      let target = Math.round(w.line + (horizontal ? dy : dx));
      // keep the corridor itself at least CMIN
      if (w.side === 's') target = ffClamp(target, orig.y + CMIN, 100);
      if (w.side === 'n') target = ffClamp(target, 0, orig.y + orig.h - CMIN);
      if (w.side === 'e') target = ffClamp(target, orig.x + CMIN, 100);
      if (w.side === 'w') target = ffClamp(target, 0, orig.x + orig.w - CMIN);
      if (w.rooms) {
        applyWall(w.rooms, target);
        const b = w.rooms.same[0].r.box;
        const opp = { n: 's', s: 'n', e: 'w', w: 'e' }[w.side];
        target = opp === 'n' ? b.y : opp === 's' ? b.y + b.h : opp === 'w' ? b.x : b.x + b.w; // where the rooms actually ended up
        paintBoxes(w.rooms.same.concat(w.rooms.facing).map(x => x.r));
      }
      if (w.side === 's') cor.h = target - cor.y;
      if (w.side === 'e') cor.w = target - cor.x;
      if (w.side === 'n') { cor.h = orig.y + orig.h - target; cor.y = target; }
      if (w.side === 'w') { cor.w = orig.x + orig.w - target; cor.x = target; }
    });
    Object.assign(ffDrag.el.style, { left: `${cor.x}%`, top: `${cor.y}%`, width: `${cor.w}%`, height: `${cor.h}%` });
    const pop = document.querySelector('.fmap-pop'); if (pop) pop.hidden = true;
    return;
  }

  if (ffDrag.mode === 'draw') {
    ffDrag.cur = p;
    const box = drawBox(ffDrag);
    const el = document.getElementById('fmapDraw');
    if (el) {
      el.hidden = false;
      Object.assign(el.style, { left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` });
      el.textContent = box.w >= FMAP_MIN && box.h >= FMAP_MIN ? 'New room' : '';
    }
    return;
  }

  const { orig, room, handle } = ffDrag;
  const box = room.box;
  const t = wallTargets(room.floorId, room.id);
  if (ffDrag.mode === 'move') {
    let x = ffClamp(orig.x + dx, 0, 100 - orig.w);
    let y = ffClamp(orig.y + dy, 0, 100 - orig.h);
    // snap whichever edge is closest to a wall
    const sx1 = snapTo(x, t.xs); const sx2 = snapTo(x + orig.w, t.xs) - orig.w;
    x = Math.abs(sx1 - x) <= Math.abs(sx2 - x) ? sx1 : sx2;
    const sy1 = snapTo(y, t.ys); const sy2 = snapTo(y + orig.h, t.ys) - orig.h;
    y = Math.abs(sy1 - y) <= Math.abs(sy2 - y) ? sy1 : sy2;
    box.x = ffClamp(x, 0, 100 - orig.w);
    box.y = ffClamp(y, 0, 100 - orig.h);
  } else {
    const touched = new Set([room]);
    ffDrag.walls.forEach(wall => {
      const linked = new Set([...wall.same, ...wall.facing].map(x => x.r.id));
      // snap only to walls of rooms that aren't moving with this one
      const free = rooms.filter(r => r.floorId === room.floorId && r.box && !linked.has(r.id));
      const xs = [0, 100, ...free.flatMap(r => [r.box.x, r.box.x + r.box.w])];
      const ys = [0, 100, ...free.flatMap(r => [r.box.y, r.box.y + r.box.h])];
      const horizontal = wall.side === 'n' || wall.side === 's';
      const target = snapTo(wall.line + (horizontal ? dy : dx), horizontal ? ys : xs);
      applyWall(wall, target);
      wall.same.concat(wall.facing).forEach(x => touched.add(x.r));
    });
    paintBoxes([...touched]);
  }
  Object.assign(ffDrag.el.style, { left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` });
  const pop = document.querySelector('.fmap-pop');
  if (pop) pop.hidden = true;
}

/** A wall works like a real floor plan wall: dragging one side of a room also
 *  moves (1) the same side of every room lined up with it in an unbroken row,
 *  and (2) the facing side of rooms on the other side of that wall. So the
 *  whole row resizes together, and neighbours never overlap or leave gaps. */
const EDGE_EPS = 0.35;
function linkedWall(room, side) {
  const horizontal = side === 'n' || side === 's'; // wall runs left-right
  const edgeOf = (b, sd) => sd === 'n' ? b.y : sd === 's' ? b.y + b.h : sd === 'w' ? b.x : b.x + b.w;
  const opposite = { n: 's', s: 'n', e: 'w', w: 'e' }[side];
  const span = b => horizontal ? [b.x, b.x + b.w] : [b.y, b.y + b.h];
  const line = edgeOf(room.box, side);
  const pool = rooms.filter(r => r.floorId === room.floorId && r.box);
  const same = [room];
  let grew = true;
  while (grew) {
    grew = false;
    pool.forEach(r => {
      if (same.includes(r) || Math.abs(edgeOf(r.box, side) - line) > EDGE_EPS) return;
      const [a1, a2] = span(r.box);
      if (same.some(m => { const [b1, b2] = span(m.box); return a1 <= b2 + EDGE_EPS && a2 >= b1 - EDGE_EPS; })) { same.push(r); grew = true; }
    });
  }
  const facing = pool.filter(r => !same.includes(r) && Math.abs(edgeOf(r.box, opposite) - line) <= EDGE_EPS
    && same.some(m => { const [a1, a2] = span(r.box); const [b1, b2] = span(m.box); return Math.min(a2, b2) - Math.max(a1, b1) > EDGE_EPS; }));
  return {
    side, line,
    same: same.map(r => ({ r, o: { ...r.box } })),
    facing: facing.map(r => ({ r, o: { ...r.box } })),
  };
}

/** Moves a linked wall to `target`, clamped so no room gets smaller than FMAP_MIN. */
function applyWall(wall, target) {
  const { side, line } = wall;
  let lo = 0;
  let hi = 100;
  wall.same.forEach(({ o }) => {
    if (side === 's') lo = Math.max(lo, o.y + FMAP_MIN);
    if (side === 'n') hi = Math.min(hi, o.y + o.h - FMAP_MIN);
    if (side === 'e') lo = Math.max(lo, o.x + FMAP_MIN);
    if (side === 'w') hi = Math.min(hi, o.x + o.w - FMAP_MIN);
  });
  wall.facing.forEach(({ o }) => {
    if (side === 's') hi = Math.min(hi, o.y + o.h - FMAP_MIN);
    if (side === 'n') lo = Math.max(lo, o.y + FMAP_MIN);
    if (side === 'e') hi = Math.min(hi, o.x + o.w - FMAP_MIN);
    if (side === 'w') lo = Math.max(lo, o.x + FMAP_MIN);
  });
  const v = ffClamp(target, lo, hi);
  const d = v - line;
  wall.same.forEach(({ r, o }) => {
    if (side === 's') r.box.h = o.h + d;
    if (side === 'e') r.box.w = o.w + d;
    if (side === 'n') { r.box.y = o.y + d; r.box.h = o.h - d; }
    if (side === 'w') { r.box.x = o.x + d; r.box.w = o.w - d; }
  });
  wall.facing.forEach(({ r, o }) => {
    if (side === 's') { r.box.y = o.y + d; r.box.h = o.h - d; }
    if (side === 'n') r.box.h = o.h + d;
    if (side === 'e') { r.box.x = o.x + d; r.box.w = o.w - d; }
    if (side === 'w') r.box.w = o.w + d;
  });
}

/** The rooms pushed by one side of a corridor: the row of rooms whose facing
 *  wall sits on that side (they move together, like dragging their wall). */
function corridorWall(cor, side) {
  const opposite = { n: 's', s: 'n', e: 'w', w: 'e' }[side];
  const line = side === 'n' ? cor.y : side === 's' ? cor.y + cor.h : side === 'w' ? cor.x : cor.x + cor.w;
  const horizontal = side === 'n' || side === 's';
  const edgeOf = (b, sd) => sd === 'n' ? b.y : sd === 's' ? b.y + b.h : sd === 'w' ? b.x : b.x + b.w;
  const [c1, c2] = horizontal ? [cor.x, cor.x + cor.w] : [cor.y, cor.y + cor.h];
  const touching = rooms.find(r => r.floorId === state.currentFloorId && r.box
    && Math.abs(edgeOf(r.box, opposite) - line) <= EDGE_EPS
    && Math.min(c2, horizontal ? r.box.x + r.box.w : r.box.y + r.box.h) - Math.max(c1, horizontal ? r.box.x : r.box.y) > EDGE_EPS);
  return { side, line, rooms: touching ? linkedWall(touching, opposite) : null };
}

function paintBoxes(list) {
  list.forEach(r => {
    const el = document.querySelector(`.fmap-room[data-ff-id="${r.id}"]`);
    if (el) Object.assign(el.style, { left: `${r.box.x}%`, top: `${r.box.y}%`, width: `${r.box.w}%`, height: `${r.box.h}%` });
  });
}

function drawBox(d) {
  const t = wallTargets(d.floor.id, null);
  const x1 = ffClamp(snapTo(Math.min(d.start.x, d.cur.x), t.xs), 0, 100);
  const x2 = ffClamp(snapTo(Math.max(d.start.x, d.cur.x), t.xs), 0, 100);
  const y1 = ffClamp(snapTo(Math.min(d.start.y, d.cur.y), t.ys), 0, 100);
  const y2 = ffClamp(snapTo(Math.max(d.start.y, d.cur.y), t.ys), 0, 100);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function ffPointerUp() {
  if (!ffDrag) return;
  const d = ffDrag;
  ffDrag = null;
  if (d.mode === 'cmove' || d.mode === 'cresize') {
    d.el.classList.remove('dragging');
    state.layoutSelected = `cor:${d.cor.id}`;
    state.layoutRenaming = false;
    render();
    if (d.moved) saveState();
    return;
  }
  if (d.mode === 'draw') {
    if (!d.moved) { render(); return; } // click on empty floor = deselect
    const box = drawBox(d);
    if (box.w < FMAP_MIN || box.h < FMAP_MIN) { render(); return; }
    const name = nextRoomName(d.floor.id);
    const id = uid('room');
    rooms.push({ id, floorId: d.floor.id, name, side: 'left', pos: 9999, devices: [], notes: [], box });
    normalizeRoomPositions(d.floor.id, 'left');
    state.layoutSelected = id;
    state.layoutRenaming = true; // type the real name straight away
    render();
    saveState();
    return;
  }
  d.el.classList.remove('dragging');
  if (!d.moved) {
    state.layoutSelected = d.room.id;
    state.layoutRenaming = false;
    render();
    return;
  }
  state.layoutSelected = d.room.id;
  render();
  saveState();
}

function fmapRenameSave() {
  const room = rooms.find(r => r.id === state.layoutSelected);
  const input = document.getElementById('fmapName');
  if (!room || !input) return;
  const name = normalizeText(input.value);
  const nameError = validateName(name, 'Room name');
  const dup = rooms.some(r => r.id !== room.id && r.floorId === room.floorId && r.name?.toLowerCase() === name.toLowerCase());
  if (nameError || dup) { showToast(nameError || 'A room with that name already exists on this floor.', 'error'); input.focus(); return; }
  room.name = name;
  state.layoutRenaming = false;
  render();
  saveState();
}

function floorMgrChanged(message) {
  render();
  saveState();
  renderFloorManager();
  if (message) showToast(message);
}

function fmMove(roomId, dir) {
  const room = findRoom(roomId);
  if (!room) return;
  const list = rooms.filter(r => r.floorId === room.floorId && r.side === room.side).sort((a, b) => a.pos - b.pos);
  const index = list.findIndex(r => r.id === roomId);
  const target = index + dir;
  if (target < 0 || target >= list.length) return;
  moveRoomToSlot(roomId, room.side, target + 1);
  floorMgrChanged();
}

function fmSwitch(roomId) {
  const room = findRoom(roomId);
  if (!room) return;
  const list = rooms.filter(r => r.floorId === room.floorId && r.side === room.side).sort((a, b) => a.pos - b.pos);
  const index = list.findIndex(r => r.id === roomId);
  const other = room.side === 'left' ? 'right' : 'left';
  moveRoomToSlot(roomId, other, index + 1); // straight across the corridor
  floorMgrChanged(`${room.name} moved to the ${other} side.`);
}

function fmRenameSave(roomId) {
  const room = findRoom(roomId);
  const input = document.getElementById(`fmRename_${roomId}`);
  if (!room || !input) return;
  const name = normalizeText(input.value);
  if (name === room.name) { floorMgrRenaming = null; renderFloorManager(); return; }
  const nameError = validateName(name, 'Room name');
  const dup = rooms.some(r => r.id !== room.id && r.floorId === room.floorId && r.name?.toLowerCase() === name.toLowerCase());
  if (nameError || dup) {
    showToast(nameError || 'A room with that name already exists on this floor.', 'error');
    input.focus();
    return;
  }
  room.name = name;
  floorMgrRenaming = null;
  floorMgrChanged('Room renamed.');
}

function fmAddSave(side) {
  const input = document.getElementById(`fmAddName_${side}`);
  const name = normalizeText(input?.value);
  const error = addRoomAt(name, side, 9999);
  if (error) {
    showToast(error, 'error');
    input?.focus();
    return;
  }
  floorMgrAdding = null;
  floorMgrChanged(`${name} added.`);
}

export function confirmEditFloor() {
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

  const renamed = floor.name !== name;
  floor.name = name;
  closeModal('editFloorModal');
  if (!renamed) return;
  render();
  initSearchFilters();
  saveState();
  showToast('Floor renamed.');
}

export function deleteFloor(floorId) {
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
    message: `Delete "${floor.name}"?\n\nThis floor contains ${floorRooms.length} room${floorRooms.length === 1 ? '' : 's'}, ${deviceCount} device${deviceCount === 1 ? '' : 's'}, and ${noteCount} room note${noteCount === 1 ? '' : 's'}. You can restore it from Settings → Recently deleted for 30 days.`,
    confirmText: 'Delete Floor',
    danger: true,
    onConfirm: () => {
      const trashId = addToTrash({
        kind: 'floor', name: floor.name, deletedBy: deletedBy(),
        floor, floorIndex: floors.findIndex(f => f.id === floorId), rooms: floorRooms,
        ...snapshotDevices(floorRooms.flatMap(r => r.devices)),
      });
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
      showUndoToast(`${floor.name} deleted.`, trashId);
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
  showToast('Room layout updated.');
}

function handleRoomDragEnd() {
  document.querySelectorAll('[data-room-draggable="true"]').forEach(el => el.classList.remove('dragging-room'));
  clearRoomDropState();
  draggedRoomId = null;
}

export function openRoom(roomId) {
  setEditingNote(null);
  state.currentRoom = rooms.find(room => room.id === roomId) || null;
  render();
  setTimeout(initDrag, 40);
}

export function goBack() {
  setEditingNote(null);
  state.currentRoom = null;
  render();
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
}

function addNote(target, event) {
  setEditingNote(null); // adding re-renders the list; don't leave a stale editor open
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

  const session = getAuthSession();
  const who = session?.username || (isAdminSession() ? 'Admin' : 'Employee');
  const note = {
    id: noteUid(),
    text,
    author: who,
    // The uid is what canDeleteNote() matches on — a username can be
    // reused/renamed, and it's also what the 48h expiry sweep reads.
    authorId: session?.id || '',
    // Server-corrected clock, so a machine with a wrong date can't post a
    // note that outlives the 48h window (or vanishes immediately).
    createdAt: new Date(serverNow()).toISOString(),
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
    broadcastActivity(`${who} added a note on ${room.name}.`);
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
    saveDeviceState(targetId);
    showToast('Device note added.');
    broadcastActivity(`${who} added a note on ${device.label} (${room.name}).`);
  }
}

/** The live notes array a note button refers to, so edit/delete both read
 *  from the same place. Room notes live in the rooms tree, device notes in
 *  that device's devState entry. */
function noteListFor(noteTarget, targetId) {
  if (noteTarget === 'room') return findRoom(targetId)?.notes || [];
  return getDeviceState(targetId).notes || [];
}

/** Re-render whichever surface the note lives on, and persist through the
 *  matching scoped path. */
function refreshNoteSurface(noteTarget, targetId, roomId, { persist = true } = {}) {
  if (noteTarget === 'room') {
    const room = findRoom(targetId);
    if (room) state.currentRoom = room;
    render();
    if (persist) saveState();
  } else {
    rebuildPanelForDevice(targetId, roomId);
    if (persist) saveDeviceState(targetId);
  }
}

function startEditNote(target) {
  const { noteTarget, targetId, room: roomId, noteId } = target.dataset;
  const note = noteListFor(noteTarget, targetId).find(entry => entry.id === noteId);
  if (!note || !canDeleteNote(note)) return;
  setEditingNote(noteId);
  refreshNoteSurface(noteTarget, targetId, roomId, { persist: false });
  const input = document.getElementById(`noteEdit_${noteId}`);
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

function cancelEditNote(target) {
  const { noteTarget, targetId, room: roomId } = target.dataset;
  setEditingNote(null);
  refreshNoteSurface(noteTarget, targetId, roomId, { persist: false });
}

function saveEditNote(target) {
  const { noteTarget, targetId, room: roomId, noteId } = target.dataset;
  const note = noteListFor(noteTarget, targetId).find(entry => entry.id === noteId);
  if (!note || !canDeleteNote(note)) { setEditingNote(null); return; }

  const input = document.getElementById(`noteEdit_${noteId}`);
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
  if (text === note.text) { // nothing changed — don't stamp "edited" or write
    setEditingNote(null);
    refreshNoteSurface(noteTarget, targetId, roomId, { persist: false });
    return;
  }

  note.text = text;
  // Editing does not reset createdAt — the 48h expiry is measured from when
  // the note was written, so a note can't be kept alive forever by editing it.
  note.editedAt = new Date(serverNow()).toISOString();
  setEditingNote(null);
  refreshNoteSurface(noteTarget, targetId, roomId);
  showToast('Note updated.');
}

function deleteNote(target) {
  const noteTarget = target.dataset.noteTarget;
  const targetId = target.dataset.targetId;
  const roomId = target.dataset.room;
  const noteId = target.dataset.noteId;

  // Admins can delete any note; everyone else only their own. The button
  // is already hidden otherwise (see noteRows), but re-check here so the
  // rule holds even if the markup is stale or tampered with.
  const notes = noteTarget === 'room'
    ? (findRoom(targetId)?.notes || [])
    : (getDeviceState(targetId).notes || []);
  const note = notes.find(entry => entry.id === noteId);
  if (!note || !canDeleteNote(note)) {
    showToast('You can only delete notes you added.', 'error');
    return;
  }

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
        saveState();
      } else if (noteTarget === 'device') {
        const st = getDeviceState(targetId);
        st.notes = (st.notes || []).filter(note => note.id !== noteId);
        rebuildPanelForDevice(targetId, roomId);
        saveDeviceState(targetId);
      }
      showToast('Note deleted.', 'success');
    },
  });
}

const STATUS_CYCLE = [STATUS.FREE, STATUS.IN_USE, STATUS.NOT_AVAILABLE];

function cycleDeviceStatus(devId, roomId) {
  const current = getDeviceState(devId).status;
  const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length];
  commitDeviceStatus(devId, roomId, next); // persists + announces, unlike updateDeviceStatus()
  // The search-results dropdown lives outside #app, so render() doesn't
  // touch it — if it's open (cycling from a results row), rebuild it so
  // the row's status pill and toggle reflect the change immediately.
  const sr = document.getElementById('searchResults');
  if (sr?.classList.contains('open')) {
    handleSearch(document.getElementById('snSearchInput')?.value || '');
  }
  const label = next === STATUS.FREE ? 'free to use' : next === STATUS.IN_USE ? 'in use' : 'not available';
  showToast(`Device marked as ${label}.`);
}

function showFreeNow() {
  const floorSelect = document.getElementById('filterFloor');
  const roomInput = document.getElementById('filterRoom');
  const typeSelect = document.getElementById('filterType');
  const statusSelect = document.getElementById('filterStatus');
  const searchInput = document.getElementById('snSearchInput');
  if (floorSelect) floorSelect.value = 'all';
  if (roomInput) roomInput.value = '';
  if (typeSelect) typeSelect.value = 'all';
  if (statusSelect) statusSelect.value = STATUS.FREE;
  if (searchInput) searchInput.value = '';
  state.searchFilters = { floorId: 'all', room: '', type: 'all', status: STATUS.FREE };
  saveLocalUIState();
  handleSearch('');
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
  saveLocalUIState();
}

// Actions that operate the search-results dropdown and so must not close it.
// (Rows inside the dropdown are covered separately by a contains() check —
// this set is for controls that live outside it.)
const SEARCH_PANEL_ACTIONS = new Set(['show-free-now', 'clear-filters', 'cycle-status']);

// Clicking the dimmed area around a modal closes it, the same way Escape
// does. Guarded on the pointerdown target so a drag that *starts* inside
// the dialog (selecting text, then releasing over the backdrop) doesn't
// count as an outside click.
let backdropPressTarget = null;

function handleBackdropPointerDown(event) {
  backdropPressTarget = event.target;
}

function closeOpenModal(modalBg) {
  if (modalBg.id === 'confirmModal') closeConfirm();
  else closeModal(modalBg.id);
}

function handleClick(event) {
  const target = event.target?.nodeType === 3 ? event.target.parentNode : event.target;

  if (
    target?.classList?.contains('modal-bg') &&
    target.classList.contains('open') &&
    backdropPressTarget === target
  ) {
    closeOpenModal(target);
    return;
  }

  const actionEl = target?.closest?.('[data-action]');
  const action = actionEl ? actionEl.dataset.action : null;

  // Form controls carry data-action for the input/change/keydown handlers,
  // not for clicks — dispatching them here meant e.g. clicking inside the
  // rename-device input (data-action="save-dev-name") to move the caret
  // instantly saved and closed the editor.
  if (actionEl && ['INPUT', 'SELECT', 'TEXTAREA'].includes(actionEl.tagName)) return;

  if (action === 'close-panel' && actionEl.id === 'panelBg' && target !== actionEl) return;
  if (action === 'open-room' && actionEl.closest('.fmap.editing')) return;

  if (action === 'do-login') {
    const username = document.getElementById('loginUser')?.value || '';
    const password = document.getElementById('loginPass')?.value || '';
    login(username, password).then(async result => {
      if (!result.ok) { renderLogin(result.error); return; }
      await startLiveSync();
      render();
    });
    return;
  }

  if (action === 'do-setup') {
    const username = document.getElementById('setupUser')?.value || '';
    const password = document.getElementById('setupPass')?.value || '';
    const confirm  = document.getElementById('setupPass2')?.value || '';
    if (password !== confirm) { renderSetup('Passwords do not match.'); return; }
    createUser(username, password, 'admin').then(async result => {
      if (!result.ok) { renderSetup(result.error); return; }
      // createUser already signed the new admin in on this browser.
      await startLiveSync();
      render();
    });
    return;
  }

  if (action === 'do-logout') {
    stopLiveSync();
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

  if (action === 'open-notifications') {
    const modal = document.getElementById('notificationsModal');
    const body  = document.getElementById('notificationsBody');
    if (body) body.innerHTML = renderNotificationsList();
    if (modal) modal.classList.add('open');
    markNotificationsSeen();
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
        removeUser(userId).then(result => {
          if (!result.ok) { showToast(result.error, 'error'); return; }
          const body = document.getElementById('userMgmtBody');
          if (body) body.innerHTML = renderUserMgmtContent();
          showToast('User deleted.', 'success');
        });
      },
    });
    return;
  }

  if (action && actionHandlers[action]) {
    // Any action outside the results dropdown dismisses it first — otherwise
    // switching floor or opening a room left the results panel hanging over
    // the new view (handleClick returns early once an action matches, so the
    // click-outside dismissal further down never ran). Actions that drive the
    // dropdown itself are exempt.
    const sr = document.getElementById('searchResults');
    if (sr?.classList.contains('open') && !SEARCH_PANEL_ACTIONS.has(action) && !sr.contains(actionEl)) {
      clearSearch();
    }
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
  'add-room-at': target => openAddRoomModal(target.dataset.side, target.dataset.slotIndex),
  'add-room-side': target => fillAddRoomWhere(target.dataset.side),
  'fm-move': target => fmMove(target.dataset.room, Number(target.dataset.dir)),
  'fm-switch': target => fmSwitch(target.dataset.room),
  'fm-rename': target => { floorMgrRenaming = target.dataset.room; floorMgrAdding = null; renderFloorManager(); },
  'fm-rename-save': target => fmRenameSave(target.dataset.room),
  'fm-delete': target => deleteRoom(target.dataset.room),
  'fm-add': target => { floorMgrAdding = target.dataset.side; floorMgrRenaming = null; renderFloorManager(); },
  'fm-add-save': target => fmAddSave(target.dataset.side),
  'fm-add-cancel': () => { floorMgrAdding = null; renderFloorManager(); },
  'add-device': target => openAddDevModal(target.dataset.room),
  'add-bed': target => addBedToRoom(target.dataset.room),
  'edit-room': target => openEditRoomModal(target.dataset.room),
  'delete-room': target => deleteRoom(target.dataset.room),
  // Delete lives inside the Edit popups now, away from the everyday buttons.
  'delete-editing-room': () => { const id = state.editingRoomId; closeModal('editRoomModal'); if (id) deleteRoom(id); },
  'delete-editing-floor': () => { const id = state.editingFloorId; closeModal('editFloorModal'); if (id) deleteFloor(id); },
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
  'delete-saved-field': target => { delSavedField(getDeviceId(target), target.dataset.room, Number.parseInt(target.dataset.index, 10)); showToast('Field removed.'); },
  'add-field': target => addField(getDeviceId(target)),
  'save-panel': target => { savePanel(getDeviceId(target), target.dataset.room); showToast('Changes saved.'); },
  'start-edit-name': target => startEditDevName(getDeviceId(target), target.dataset.room),
  'save-dev-name': target => saveDevName(getDeviceId(target), target.dataset.room),
  'ff-edit': () => { state.layoutEditing = state.currentFloorId; state.layoutCorridor = false; state.layoutSelected = null; state.layoutRenaming = false; render(); },
  'ff-done': () => { state.layoutEditing = null; state.layoutSelected = null; state.layoutRenaming = false; state.layoutCorridor = false; render(); showToast('Layout saved.'); },
  'corr-resize': () => { state.corridorResizing = state.currentFloorId; render(); },
  'corr-done': () => { state.corridorResizing = null; render(); showToast('Corridor size saved.'); },
  'ff-corridor': () => {
    const floor = floors.find(f => f.id === state.currentFloorId);
    state.layoutEditing = state.currentFloorId;
    state.layoutCorridor = false;
    state.layoutRenaming = false;
    const first = (floor?.corridors || [])[0];
    state.layoutSelected = first ? `cor:${first.id}` : null;
    render();
    if (!first) showToast('No corridor yet. Click + Corridor to add one.', 'info');
  },
  'ff-add-corridor': () => {
    const floor = floors.find(f => f.id === state.currentFloorId);
    if (!floor || !isAdminRole()) return;
    if (!Array.isArray(floor.corridors)) floor.corridors = [];
    const spot = freeSpotFor(floor, 30, 12);
    const cor = { id: uid('cor'), ...spot };
    floor.corridors.push(cor);
    state.layoutSelected = `cor:${cor.id}`;
    render();
    saveState();
  },
  'ff-del-corridor': target => {
    const floor = floors.find(f => f.id === state.currentFloorId);
    if (!floor || !isAdminRole()) return;
    floor.corridors = (floor.corridors || []).filter(c => c.id !== target.dataset.ffId);
    state.layoutSelected = null;
    render();
    saveState();
  },
  'fmap-rename': () => { state.layoutRenaming = true; render(); },
  'fmap-rename-save': () => fmapRenameSave(),
  'fmap-open': target => { state.layoutEditing = null; state.layoutSelected = null; openRoom(target.dataset.room); },
  'ff-aspect': target => {
    const floor = floors.find(f => f.id === state.currentFloorId);
    if (!floor || !isAdminRole()) return;
    const next = (Number(floor.aspect) || 0.55) + Number(target.dataset.dir) * 0.08;
    floor.aspect = Number(Math.min(1.6, Math.max(0.3, next)).toFixed(2));
    render();
    saveState();
  },
  'set-floor-layout': target => setFloorLayout(state.editingFloorId, target.dataset.value),
  'open-settings': () => { renderSettings(); document.getElementById('settingsModal')?.classList.add('open'); },
  'set-theme': target => { setThemePref(target.dataset.value); renderSettings(); },
  'restore-trash': target => restoreFromTrash(target.dataset.trashId),
  'pick-status': target => {
    const value = target.dataset.status;
    if (!Object.values(STATUS).includes(value)) return;
    const devId = getDeviceId(target);
    if (getDeviceState(devId).status === value) return;
    commitDeviceStatus(devId, target.dataset.room, value);
    const label = value === STATUS.FREE ? 'free to use' : value === STATUS.IN_USE ? 'in use' : 'not available';
    showToast(`Saved: ${label}.`);
  },
  'start-edit-sn': target => startEditDevSn(getDeviceId(target), target.dataset.room),
  'save-dev-sn': target => saveDevSn(getDeviceId(target), target.dataset.room),
  'clear-filters': () => clearSearchFilters(),
  'show-free-now': () => showFreeNow(),
  'cycle-status': target => cycleDeviceStatus(getDeviceId(target), target.dataset.room),
  'cancel-confirm': () => closeConfirm(),
  'confirm-action': () => runConfirm(),
  'add-note': (target, event) => addNote(target, event),
  'delete-note': target => deleteNote(target),
  'edit-note': target => startEditNote(target),
  'save-edit-note': target => saveEditNote(target),
  'cancel-edit-note': target => cancelEditNote(target),
  'do-refresh': () => location.reload(),
  'toggle-password': target => {
    const input = document.getElementById(target.dataset.target);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    target.textContent = show ? 'Hide' : 'Show';
  },
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
  saveLocalUIState();
}

function isSearchControl(target) {
  return ['snSearchInput', 'filterFloor', 'filterRoom', 'filterType', 'filterStatus'].includes(target?.id);
}

function handleSearchInput() {
  updateSearchFilters();
  handleSearch(document.getElementById('snSearchInput')?.value || '');
}

let _unsubscribeState = null;
let _unsubscribeNotifications = null;
let _unsubscribeOwnProfile = null;
let _unsubscribeDeviceExpiry = null;

function updateNotifBadge() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  const count = getUnreadNotificationCount();
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? '99+' : String(count);
}

function markNotificationsSeen() {
  persistNotificationsSeen();
  updateNotifBadge();
}

function refreshNotificationsIfOpen() {
  const modal = document.getElementById('notificationsModal');
  const body = document.getElementById('notificationsBody');
  if (modal?.classList.contains('open') && body) body.innerHTML = renderNotificationsList();
}

/** Loads shared room/device state from Firebase and starts listening for
 *  teammates' live updates (data + "so-and-so changed X" toasts/bell).
 *  Only meaningful once signed in (the database rules require it), so
 *  call after a successful login or setup. */
export async function startLiveSync() {
  await loadRemoteState();
  if (_unsubscribeState) return;
  _unsubscribeState = subscribeRemoteState(() => {
    // Don't let a teammate's save yank the DOM out from under an active
    // drag (existing guard) or wipe out someone's in-progress typing in a
    // note/employee/reason field (same failure mode, same fix) — the
    // update is still applied to the in-memory state above, it just waits
    // to redraw until the field is no longer focused.
    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (!document.querySelector('.dragging') && !typing) render();
  });
  _unsubscribeNotifications = await subscribeNotifications(
    () => { updateNotifBadge(); refreshNotificationsIfOpen(); },
    entry => { if (popupsEnabled()) showToast(entry.message, 'info'); },
  );
  // A promotion/demotion by another admin should apply live, not just after
  // this browser's next login.
  _unsubscribeOwnProfile = subscribeOwnProfile(() => render());
  // Auto-frees devices left In Use / Not Available since a previous day —
  // see startDeviceStatusExpiry() in data.js.
  _unsubscribeDeviceExpiry = startDeviceStatusExpiry(() => render());
}

function stopLiveSync() {
  if (_unsubscribeState) { _unsubscribeState(); _unsubscribeState = null; }
  if (_unsubscribeNotifications) { _unsubscribeNotifications(); _unsubscribeNotifications = null; }
  if (_unsubscribeOwnProfile) { _unsubscribeOwnProfile(); _unsubscribeOwnProfile = null; }
  if (_unsubscribeDeviceExpiry) { _unsubscribeDeviceExpiry(); _unsubscribeDeviceExpiry = null; }
}

// ── daily auto-refresh so deployed changes reach open tabs ──────────
// The site is served no-cache, but an already-open tab keeps running the
// JS it loaded until it reloads. So once a day at 10:00 Kosovo time
// (Europe/Belgrade) every open tab reloads itself to pick up whatever's
// currently deployed. If the user is mid-action (dragging a device,
// typing in a field, or a modal/panel is open) we do NOT yank the page
// out from under them — we show a "please refresh" bar instead and reload
// automatically the moment they're idle. The time-of-day is derived from
// serverNow() (server-corrected clock), so a wrong local clock can't make
// it fire at the wrong moment.
const DAILY_REFRESH_HOUR = 10; // 10:00, Europe/Belgrade (Kosovo time)
const REFRESH_TIMEZONE = 'Europe/Belgrade';
let _dailyRefreshTimer = null;
let _refreshIdleTimer = null;

function belgradeSecondsSinceMidnight(epochMs) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: REFRESH_TIMEZONE, hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = t => Number(parts.find(p => p.type === t)?.value || 0);
  let h = get('hour');
  if (h === 24) h = 0; // some engines report midnight as 24
  return h * 3600 + get('minute') * 60 + get('second');
}

function msUntilNextRefresh() {
  const cur = belgradeSecondsSinceMidnight(serverNow());
  let deltaSec = DAILY_REFRESH_HOUR * 3600 - cur;
  if (deltaSec <= 0) deltaSec += 24 * 3600; // already past 10:00 today → tomorrow
  return deltaSec * 1000;
}

// Don't reload out from under someone who's actively working.
function isSafeToReload() {
  if (document.querySelector('.dragging')) return false;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return false;
  if (document.querySelector('.modal-bg.open, .panel-bg.open')) return false;
  return true;
}

function showRefreshBar() {
  const bar = document.getElementById('refreshBar');
  if (bar) bar.hidden = false;
}

function triggerDailyRefresh() {
  if (isSafeToReload()) { location.reload(); return; }
  // Busy — surface the prompt and keep watching; reload as soon as idle.
  showRefreshBar();
  if (_refreshIdleTimer) return;
  _refreshIdleTimer = setInterval(() => {
    if (isSafeToReload()) { clearInterval(_refreshIdleTimer); location.reload(); }
  }, 60 * 1000);
}

function scheduleDailyRefresh() {
  if (_dailyRefreshTimer) clearTimeout(_dailyRefreshTimer);
  _dailyRefreshTimer = setTimeout(() => {
    triggerDailyRefresh();
    scheduleDailyRefresh(); // line up tomorrow's tick (reload may be deferred)
  }, msUntilNextRefresh());
}

// ── new-deploy detection ────────────────────────────────────────────
// The daily reload above is a backstop. This catches a deploy the moment
// it lands: /version.json is re-stamped on every deploy (see deploy.sh),
// so a tab that remembers the version it loaded with can poll for a change
// and show the "please refresh" bar right away — the standard "a new
// version is available" pattern. Doesn't force a reload (that would yank
// the page mid-use); it just surfaces the bar and lets the user choose,
// exactly like the busy-at-10:00 case.
// Slow background fallback only — the responsive path is the visibility
// check below, which fires the moment someone returns to the tab. 15 min
// keeps a permanently-foregrounded tab (e.g. a wall display) current
// without polling for no reason. This is a ~40-byte static Hosting file,
// so even this is negligible, and it never touches the Realtime Database
// free-tier quota (connections / bandwidth) at all.
const VERSION_POLL_MS = 15 * 60 * 1000;
let _loadedVersion = null;

async function fetchDeployedVersion() {
  try {
    // no-store + a cache-buster so we always see the freshly deployed value,
    // never a stale cached one.
    const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.version ? String(data.version) : null;
  } catch (e) {
    return null; // offline / transient — try again next tick
  }
}

async function checkForNewVersion() {
  const latest = await fetchDeployedVersion();
  // Only prompt once we have both a baseline and a genuinely newer value.
  if (latest && _loadedVersion && latest !== _loadedVersion) showRefreshBar();
}

async function startVersionWatch() {
  _loadedVersion = await fetchDeployedVersion(); // baseline for this tab
  // Cheap and responsive: re-check when the user brings the tab back into
  // view (the exact moment they'd act on the bar), which costs nothing while
  // the tab sits in the background. The slow interval is just a fallback for
  // a tab that stays visible for hours.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForNewVersion();
  });
  setInterval(checkForNewVersion, VERSION_POLL_MS);
}

let _appInitialized = false;

export function initApp() {
  initSearchFilters();
  if (_appInitialized) return; // global listeners only ever get attached once
  _appInitialized = true;

  // Surface failed Firebase writes as error toasts — before this they died
  // silently in the console while the UI claimed the save succeeded.
  setSyncErrorHandler(message => showToast(message, 'error'));

  // Persistent "reconnecting" chip while the Firebase connection is down.
  // Only after we've been connected once (the flag always starts false
  // during startup — that's not an outage), and only if the drop lasts a
  // few seconds (brief blips self-heal without deserving a banner).
  let wasConnected = false;
  let offlineTimer = null;
  setConnectionHandler(connected => {
    const chip = document.getElementById('connChip');
    if (!chip) return;
    if (connected) {
      wasConnected = true;
      if (offlineTimer) { clearTimeout(offlineTimer); offlineTimer = null; }
      chip.hidden = true;
    } else if (wasConnected && !offlineTimer) {
      offlineTimer = setTimeout(() => {
        offlineTimer = null;
        chip.hidden = false;
      }, 4000);
    }
  });

  // Reload each open tab daily at 10:00 Kosovo time so deployed updates
  // reach people who leave the app open.
  scheduleDailyRefresh();
  // Also detect a brand-new deploy within minutes and prompt to refresh.
  startVersionWatch();

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

    if (target.id === 'addDevType') {
      syncAddDevTypeUI();
      return;
    }

    if (target.dataset.action === 'change-user-role') {
      const userId  = target.dataset.userId;
      const newRole = target.value;
      setUserRole(userId, newRole).then(result => {
        if (!result.ok) {
          showToast(result.error, 'error');
          // Reset the dropdown to reflect actual state
          const body = document.getElementById('userMgmtBody');
          if (body) body.innerHTML = renderUserMgmtContent();
          return;
        }
        showToast('Role updated.', 'success');
      });
      return;
    }

    if (target.dataset.action === 'toggle-popups') {
      try { localStorage.setItem(POPUPS_KEY, target.checked ? 'on' : 'off'); } catch (e) { /* ignore */ }
      showToast(target.checked ? 'Popups on.' : 'Popups off.', 'info');
      return;
    }

    if (target.dataset.action === 'set-status') {
      // Saves immediately. People kept forgetting the Save Changes button.
      commitDeviceStatus(getDeviceId(target), target.dataset.room, target.value);
      const label = target.value === STATUS.FREE ? 'free to use' : target.value === STATUS.IN_USE ? 'in use' : 'not available';
      showToast(`Saved: ${label}.`);
    }
  });

  document.addEventListener('keydown', event => {
    const target = event.target;
    // Escape closes whatever is topmost: confirm dialog, then any open
    // modal, then the search dropdown, then the device panel.
    if (event.key === 'Escape') {
      const confirmModal = document.getElementById('confirmModal');
      if (confirmModal?.classList.contains('open')) { closeConfirm(); return; }
      const openModalBg = document.querySelector('.modal-bg.open');
      if (openModalBg?.id) { closeModal(openModalBg.id); return; }
      // A note editor lives inside the panel/sidebar, so it has to be
      // dismissed before the panel itself.
      if (getEditingNote()) {
        document.querySelector('[data-action="cancel-edit-note"]')?.click();
        return;
      }
      const sr = document.getElementById('searchResults');
      if (sr?.classList.contains('open')) { clearSearch(); return; }
      const panelBg = document.getElementById('panelBg');
      if (panelBg?.classList.contains('open')) { closePanel(); return; }
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
    if (event.key === 'Enter' && target?.dataset?.action === 'fmap-rename-save') { fmapRenameSave(); return; }
    if (state.layoutEditing && state.layoutSelected && !['INPUT', 'TEXTAREA'].includes(target?.tagName)) {
      if (event.key === 'Escape' && !document.querySelector('.modal-bg.open')) { state.layoutSelected = null; state.layoutRenaming = false; render(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !document.querySelector('.modal-bg.open')) {
        event.preventDefault();
        if (String(state.layoutSelected).startsWith('cor:')) {
          document.querySelector(`[data-action="ff-del-corridor"]`)?.click();
        } else {
          deleteRoom(state.layoutSelected);
        }
        return;
      }
    }
    if (event.key === 'Enter' && target?.dataset?.action === 'fm-add-save') { fmAddSave(target.dataset.side); return; }
    if (event.key === 'Enter' && target?.dataset?.action === 'fm-rename-save') { fmRenameSave(target.dataset.room); return; }
    if (target?.dataset?.action === 'save-dev-sn' && event.key === 'Enter') {
      saveDevSn(getDeviceId(target), target.dataset.room);
      return;
    }
    if (target?.dataset?.action === 'save-dev-name' && event.key === 'Enter') {
      saveDevName(getDeviceId(target), target.dataset.room);
      showToast('Device name saved.');
      return;
    }
    // Enter inside any modal input submits that modal's primary action
    // (Add User, Add Room, Add Device, Add/Edit Floor…) — previously only
    // the login/setup forms supported Enter.
    if (event.key === 'Enter' && target?.tagName === 'INPUT') {
      const modal = target.closest('.modal');
      if (modal) {
        modal.querySelector('.modal-footer .btn-primary, .btn-primary')?.click();
        return;
      }
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
        saveDevicePosition(devId);
      }
    }
  });

  document.addEventListener('focusin', event => {
    const target = event.target;
    if (target?.id === 'snSearchInput' && target.value) {
      handleSearch(target.value);
    }
  });

  document.addEventListener('pointerdown', handleBackdropPointerDown, true);
  document.addEventListener('dragstart', handleRoomDragStart);
  document.addEventListener('dragover', handleRoomDragOver);
  document.addEventListener('dragenter', handleRoomDragEnter);
  document.addEventListener('dragleave', handleRoomDragLeave);
  document.addEventListener('drop', handleRoomDrop);
  document.addEventListener('dragend', handleRoomDragEnd);
  document.addEventListener('click', handleClick);
  document.addEventListener('pointerdown', ffPointerDown);
  document.addEventListener('pointerdown', corrPointerDown);
  document.addEventListener('pointermove', corrPointerMove);
  document.addEventListener('pointerup', corrPointerUp);
  document.addEventListener('pointermove', ffPointerMove);
  document.addEventListener('pointerup', ffPointerUp);
  document.addEventListener('pointercancel', ffPointerUp);
  initBackButtonGuard();
  applyTheme();
  // "Auto" follows the OS live, e.g. when Windows switches to dark at night.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

// Browser Back used to leave the app entirely. Now it steps back inside
// the app instead (closes a dialog, the device panel, or goes from a room
// to the floor), and never leaves. We keep one extra history entry on top
// ("guard"); Back pops it, we handle the step, then put it back.
function stepBackInApp() {
  const confirmModal = document.getElementById('confirmModal');
  if (confirmModal?.classList.contains('open')) { closeConfirm(); return; }
  const openModalBg = document.querySelector('.modal-bg.open');
  if (openModalBg?.id) { closeModal(openModalBg.id); return; }
  if (getEditingNote()) {
    document.querySelector('[data-action="cancel-edit-note"]')?.click();
    return;
  }
  const sr = document.getElementById('searchResults');
  if (sr?.classList.contains('open')) { clearSearch(); return; }
  const panelBg = document.getElementById('panelBg');
  if (panelBg?.classList.contains('open')) { closePanel(); return; }
  if (state.currentRoom) { goBack(); return; }
}

function initBackButtonGuard() {
  if (!window.history?.pushState) return;
  const arm = () => {
    if (history.state?.rm !== 'guard') history.pushState({ rm: 'guard' }, '');
  };
  if (history.state?.rm !== 'base' && history.state?.rm !== 'guard') {
    history.replaceState({ rm: 'base' }, '');
  }
  arm();
  // Chrome ignores history entries added before the user has interacted
  // with the page, so re-arm on interaction too (no-op if already armed).
  document.addEventListener('pointerdown', arm, true);
  document.addEventListener('keydown', arm, true);
  window.addEventListener('popstate', () => {
    stepBackInApp();
    arm();
  });
}
