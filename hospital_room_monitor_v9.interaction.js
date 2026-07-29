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

export function openAddRoomModal() {
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

export function confirmAddRoom() {
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
  const modal = document.getElementById('editFloorModal');
  if (modal) modal.classList.add('open');
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

  floor.name = name;
  closeModal('editFloorModal');
  render();
  initSearchFilters();
  saveState();
  showToast('Floor updated.');
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
  'delete-saved-field': target => { delSavedField(getDeviceId(target), target.dataset.room, Number.parseInt(target.dataset.index, 10)); showToast('Field removed.'); },
  'add-field': target => addField(getDeviceId(target)),
  'save-panel': target => { savePanel(getDeviceId(target), target.dataset.room); showToast('Changes saved.'); },
  'start-edit-name': target => startEditDevName(getDeviceId(target), target.dataset.room),
  'save-dev-name': target => saveDevName(getDeviceId(target), target.dataset.room),
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
    entry => showToast(entry.message, 'info'),
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

    if (target.dataset.action === 'set-status') {
      updateDeviceStatus(getDeviceId(target), target.dataset.room, target.value);
      const label = target.value === STATUS.FREE ? 'free to use' : target.value === STATUS.IN_USE ? 'in use' : 'not available';
      // This is a live preview only — nothing is persisted until Save
      // Changes. Don't tell the user it's done when it isn't.
      showToast(`Status set to ${label} — click Save Changes to apply.`, 'info');
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
}
