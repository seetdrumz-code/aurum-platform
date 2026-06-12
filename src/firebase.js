// src/firebase.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";

// ── Init ──────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// ── Auth Providers ────────────────────────────────────────────────────────────
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// ── Auth Helpers ──────────────────────────────────────────────────────────────
export const loginWithEmail = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);

export const registerWithEmail = async (email, password, displayName) => {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  await createUserDoc(cred.user, displayName);
  return cred;
};

export const loginWithGoogle = async () => {
  const cred = await signInWithPopup(auth, googleProvider);
  await createUserDoc(cred.user);
  return cred;
};

export const logout = () => signOut(auth);

export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

export const onAuth = (cb) => onAuthStateChanged(auth, cb);

// ── Firestore: User ───────────────────────────────────────────────────────────
const createUserDoc = async (user, name) => {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid:         user.uid,
      email:       user.email,
      displayName: name || user.displayName || user.email?.split("@")[0],
      plan:        "pro",
      createdAt:   serverTimestamp(),
      preferences: { currency:"USD", theme:"dark", notifications:true },
    });
  }
};

export const getUserDoc = async (uid) => {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
};

export const updateUserDoc = (uid, data) =>
  updateDoc(doc(db, "users", uid), { ...data, updatedAt: serverTimestamp() });

// ── Firestore: Portfolio ──────────────────────────────────────────────────────
export const getPortfolio = async (uid) => {
  const snap = await getDoc(doc(db, "portfolios", uid));
  return snap.exists() ? snap.data().holdings : null;
};

export const savePortfolio = (uid, holdings) =>
  setDoc(doc(db, "portfolios", uid), { holdings, updatedAt: serverTimestamp() });

// ── Firestore: Alerts ─────────────────────────────────────────────────────────
export const getAlerts = async (uid) => {
  const q    = query(collection(db, "users", uid, "alerts"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const addAlert = (uid, alert) =>
  addDoc(collection(db, "users", uid, "alerts"), { ...alert, createdAt: serverTimestamp() });

export const updateAlert = (uid, alertId, data) =>
  updateDoc(doc(db, "users", uid, "alerts", alertId), data);

export const deleteAlert = (uid, alertId) =>
  deleteDoc(doc(db, "users", uid, "alerts", alertId));

export const watchAlerts = (uid, cb) =>
  onSnapshot(
    query(collection(db, "users", uid, "alerts"), orderBy("createdAt", "desc")),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ── Firestore: Transactions ───────────────────────────────────────────────────
export const getTransactions = async (uid, lim = 100) => {
  const q    = query(collection(db, "users", uid, "transactions"), orderBy("date", "desc"), limit(lim));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const addTransaction = (uid, tx) =>
  addDoc(collection(db, "users", uid, "transactions"), { ...tx, date: serverTimestamp() });

// ── Firestore: Settings ───────────────────────────────────────────────────────
export const watchSettings = (uid, cb) =>
  onSnapshot(doc(db, "users", uid), snap => snap.exists() && cb(snap.data()));
