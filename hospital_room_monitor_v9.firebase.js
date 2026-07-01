// ─────────────────────────────────────────────────────────────────
//  Firebase — Realtime Database + Authentication connection
// ─────────────────────────────────────────────────────────────────
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onChildAdded, onChildRemoved,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBIvFoeimbHWRyXXn0WDMNYOPiCNuVZbzM',
  authDomain: 'room-monitor-6902b.firebaseapp.com',
  databaseURL: 'https://room-monitor-6902b-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'room-monitor-6902b',
  storageBucket: 'room-monitor-6902b.firebasestorage.app',
  messagingSenderId: '739324818581',
  appId: '1:739324818581:web:46e2c1a7f622265073d79c',
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export {
  ref, get, set, update, remove, push, onValue, onChildAdded, onChildRemoved,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
};

/** Creates a Firebase Auth account for someone else without disturbing the
 *  caller's own signed-in session — done via a throwaway secondary app
 *  instance, since the client SDK normally signs in as whatever account
 *  it just created. */
export async function createManagedUser(email, password) {
  const secondary = initializeApp(firebaseConfig, 'hrm-create-' + Math.random().toString(36).slice(2));
  try {
    const secondaryAuth = getAuth(secondary);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await signOut(secondaryAuth);
    return cred.user.uid;
  } finally {
    await deleteApp(secondary);
  }
}
