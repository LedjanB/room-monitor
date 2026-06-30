// ─────────────────────────────────────────────────────────────────
//  Auth — user store (localStorage) + session (sessionStorage)
//  Passwords are SHA-256 hashed; never stored in plain text.
// ─────────────────────────────────────────────────────────────────

const AUTH_KEY    = 'hrm_auth_v2';
const SESSION_KEY = 'hrm_sess_v2';

let _data    = { users: [] }; // persists across sessions
let _session = null;          // { id, username, role } — cleared on tab close

// ── persistence ───────────────────────────────────────────────────

export function loadAuth() {
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

export function isFirstRun()     { return _data.users.length === 0; }
export function isLoggedIn()     { return !!_session; }
export function getAuthSession() { return _session; }
export function isAdminSession() { return _session?.role === 'admin'; }

/** Returns safe copies — no passwordHash exposed */
export function getAuthUsers() {
  return _data.users.map(u => ({
    id: u.id, username: u.username, role: u.role, createdAt: u.createdAt,
  }));
}

// ── login / logout ────────────────────────────────────────────────

export async function login(username, password) {
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

export function logout() {
  _session = null;
  sessionStorage.removeItem(SESSION_KEY);
}

// ── user management (admin-only operations) ───────────────────────

export async function createUser(username, password, role) {
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

export function removeUser(userId) {
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

export function setUserRole(userId, newRole) {
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

export async function changeUserPassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 4)
    return { ok: false, error: 'Password must be at least 4 characters.' };
  const user = _data.users.find(u => u.id === userId);
  if (!user) return { ok: false, error: 'User not found.' };
  user.passwordHash = await _hash(newPassword);
  _save();
  return { ok: true };
}
