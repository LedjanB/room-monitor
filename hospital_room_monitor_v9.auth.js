// ─────────────────────────────────────────────────────────────────
//  Auth — real Firebase Authentication, gated by an admin-provisioned
//  profile in the Realtime Database (so only accounts an admin created
//  via "Add User" can actually access app data — see database.rules.json).
//  Usernames are mapped to throwaway @hrm.local emails since Firebase
//  Auth's email/password sign-in needs an email shape.
// ─────────────────────────────────────────────────────────────────
import {
  db, ref, get, set, update, remove, onValue, auth,
  signInWithEmailAndPassword, signOut, onAuthStateChanged, createManagedUser,
} from './hospital_room_monitor_v9.firebase.js';

const usersRef    = ref(db, 'users');
const initFlagRef = ref(db, 'meta/initialized');
const EMAIL_DOMAIN = 'hrm.local';

let _data     = { users: [] }; // populated for admins only (see attachUsersListener)
let _session  = null;          // { id, username, role }
let _firstRun = true;
let _usersUnsub = null;
let _ownProfileUnsub = null;

function usernameToEmail(username) {
  const local = (username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'user';
  return `${local}@${EMAIL_DOMAIN}`;
}

function friendlyAuthError(e) {
  const code = e?.code || '';
  if (code.includes('email-already-in-use')) return 'That username is already taken.';
  if (code.includes('weak-password'))         return 'Password must be at least 6 characters.';
  if (code.includes('invalid-email'))         return 'That username has characters Firebase can’t use — try letters, numbers, dots, dashes or underscores.';
  return 'Could not create the account. Please try again.';
}

function attachUsersListener() {
  if (_usersUnsub || _session?.role !== 'admin') return;
  _usersUnsub = onValue(usersRef, snap => {
    _data = { users: snap.exists() ? Object.values(snap.val()) : [] };
  }, e => {
    // Rules deny this once we're no longer admin — reset the guard so a
    // later re-promotion (same browser session) can re-attach instead of
    // being permanently blocked by a stale non-null _usersUnsub.
    console.warn('Failed to sync users list', e);
    _usersUnsub = null;
    _data = { users: [] };
  });
}

function detachUsersListener() {
  if (_usersUnsub) { _usersUnsub(); _usersUnsub = null; }
  _data = { users: [] };
}

/** Keeps _session.role live: without this, a promotion/demotion made by
 *  another admin only takes effect for the affected browser after a
 *  logout/login, even though the database rules enforce the new role
 *  immediately — the UI would just look stale in the meantime. */
export function subscribeOwnProfile(onRoleChange) {
  if (_ownProfileUnsub || !_session) return () => {};
  const myId = _session.id;
  const myRef = ref(db, `users/${myId}`);
  _ownProfileUnsub = onValue(myRef, snap => {
    if (!snap.exists() || !_session || _session.id !== myId) return;
    const profile = snap.val();
    if (profile.role !== _session.role) {
      _session.role = profile.role;
      if (profile.role === 'admin') attachUsersListener();
      else detachUsersListener();
      onRoleChange();
    }
  }, e => console.warn('Failed to sync own profile', e));
  return () => {
    if (_ownProfileUnsub) { _ownProfileUnsub(); _ownProfileUnsub = null; }
  };
}

// ── persistence ───────────────────────────────────────────────────

/** Resolves once we know: has the team been set up yet, and is this
 *  browser already signed in (Firebase persists sign-in across reloads)? */
export async function loadAuth() {
  try {
    const snap = await get(initFlagRef);
    _firstRun = !(snap.exists() && snap.val() === true);
  } catch (e) {
    console.warn('Failed to check setup status', e);
  }

  await new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, async fbUser => {
      unsub();
      if (!fbUser) { _session = null; resolve(); return; }
      try {
        const snap = await get(ref(db, `users/${fbUser.uid}`));
        if (snap.exists()) {
          const profile = snap.val();
          _session = { id: fbUser.uid, username: profile.username, role: profile.role };
          attachUsersListener();
        } else {
          // Firebase account exists but was never provisioned (or an
          // admin removed it) — no app access.
          await signOut(auth);
          _session = null;
        }
      } catch (e) {
        console.warn('Failed to restore session', e);
        _session = null;
      }
      resolve();
    });
  });
}

// ── queries ───────────────────────────────────────────────────────

export function isFirstRun()     { return _firstRun; }
export function isLoggedIn()     { return !!_session; }
export function getAuthSession() { return _session; }
export function isAdminSession() { return _session?.role === 'admin'; }

export function getAuthUsers() {
  return _data.users.map(u => ({
    id: u.id, username: u.username, role: u.role, createdAt: u.createdAt,
  }));
}

// ── login / logout ────────────────────────────────────────────────

export async function login(username, password) {
  let cred;
  try {
    cred = await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
  } catch (e) {
    // Don't blame the user's credentials for a network problem.
    const code = e?.code || '';
    if (code.includes('network-request-failed'))
      return { ok: false, error: 'Network error — check your connection and try again.' };
    if (code.includes('too-many-requests'))
      return { ok: false, error: 'Too many attempts — please wait a moment and try again.' };
    return { ok: false, error: 'Invalid username or password.' };
  }

  let profile = null;
  try {
    const snap = await get(ref(db, `users/${cred.user.uid}`));
    if (snap.exists()) profile = snap.val();
  } catch (e) { /* falls through to the not-provisioned error below */ }

  if (!profile) {
    await signOut(auth);
    _session = null;
    return { ok: false, error: 'This account is not set up. Ask an admin to add you.' };
  }

  _session = { id: cred.user.uid, username: profile.username, role: profile.role };
  attachUsersListener();
  return { ok: true };
}

export function logout() {
  _session = null;
  detachUsersListener();
  if (_ownProfileUnsub) { _ownProfileUnsub(); _ownProfileUnsub = null; }
  signOut(auth).catch(e => console.warn('Sign out failed', e));
}

// ── user management (admin-only operations) ───────────────────────

export async function createUser(username, password, role) {
  const name = (username || '').trim();
  if (!name)            return { ok: false, error: 'Username is required.' };
  if (name.length < 2)  return { ok: false, error: 'Username must be at least 2 characters.' };
  if (name.length > 40) return { ok: false, error: 'Username must be 40 characters or less.' };
  if (!password || password.length < 6)
    return { ok: false, error: 'Password must be at least 6 characters.' };
  if (!['admin', 'user'].includes(role))
    return { ok: false, error: 'Role must be admin or user.' };
  if (_data.users.some(u => u.username.toLowerCase() === name.toLowerCase()))
    return { ok: false, error: 'That username is already taken.' };

  const email = usernameToEmail(name);
  let uid;
  try {
    uid = await createManagedUser(email, password);
  } catch (e) {
    return { ok: false, error: friendlyAuthError(e) };
  }

  const user = { id: uid, username: name, role, createdAt: new Date().toISOString() };

  if (_firstRun) {
    // Bootstrap: sign the new admin in on this browser, then let them
    // write their own profile (database.rules.json allows that one
    // self-write before a profile exists).
    try {
      await signInWithEmailAndPassword(auth, email, password);
      await set(ref(db, `users/${uid}`), user);
      await set(initFlagRef, true);
      _firstRun = false;
      _session = { id: uid, username: name, role };
      attachUsersListener();
    } catch (e) {
      return { ok: false, error: 'Account created but setup failed — please try logging in.' };
    }
  } else {
    // Await the profile write — without it the new person has a Firebase
    // Auth account but no profile, and login refuses them, while the admin
    // was told everything worked.
    try {
      await set(ref(db, `users/${uid}`), user);
    } catch (e) {
      console.warn('Failed to save user profile', e);
      return { ok: false, error: 'The account was created but saving its profile failed — check your connection and try again.' };
    }
    _data.users.push(user);
  }

  return { ok: true, user };
}

export async function removeUser(userId) {
  const user = _data.users.find(u => u.id === userId);
  if (!user) return { ok: false, error: 'User not found.' };
  if (_session && _session.id === userId)
    return { ok: false, error: 'You cannot delete your own account.' };
  if (user.role === 'admin') {
    const adminCount = _data.users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1)
      return { ok: false, error: 'Cannot delete the last admin account.' };
  }
  // Removes their app access (the profile a login depends on). Their
  // underlying Firebase Auth sign-in still technically exists — the
  // client SDK can't delete other accounts without a backend — but
  // without a profile they can never get past login again.
  // Awaited so a failed delete isn't reported as success.
  try {
    await remove(ref(db, `users/${userId}`));
  } catch (e) {
    console.warn('Failed to remove user', e);
    return { ok: false, error: 'Could not delete the user — check your connection and try again.' };
  }
  _data.users = _data.users.filter(u => u.id !== userId);
  return { ok: true };
}

export async function setUserRole(userId, newRole) {
  if (!['admin', 'user'].includes(newRole))
    return { ok: false, error: 'Invalid role.' };
  const user = _data.users.find(u => u.id === userId);
  if (!user) return { ok: false, error: 'User not found.' };
  if (user.role === 'admin' && newRole !== 'admin') {
    const adminCount = _data.users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1)
      return { ok: false, error: 'Cannot demote the only admin.' };
  }
  try {
    await update(ref(db, `users/${userId}`), { role: newRole });
  } catch (e) {
    console.warn('Failed to update role', e);
    return { ok: false, error: 'Could not update the role — check your connection and try again.' };
  }
  user.role = newRole;
  if (_session && _session.id === userId) _session.role = newRole;
  return { ok: true };
}
