// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from "react";
import {
  onAuth, getUserDoc, loginWithEmail, registerWithEmail,
  loginWithGoogle, logout, resetPassword,
} from "../firebase";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export default function AuthProvider({ children }) {
  const [user,    setUser]    = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    const unsub = onAuth(async (u) => {
      setUser(u);
      if (u) {
        const prof = await getUserDoc(u.uid);
        setProfile(prof);
      } else {
        setProfile(null);
      }
    });
    return unsub;
  }, []);

  const signIn = async (email, password) => {
    setError(null);
    try { await loginWithEmail(email, password); }
    catch (e) { setError(friendlyError(e.code)); throw e; }
  };

  const signUp = async (email, password, name) => {
    setError(null);
    try { await registerWithEmail(email, password, name); }
    catch (e) { setError(friendlyError(e.code)); throw e; }
  };

  const signInGoogle = async () => {
    setError(null);
    try { await loginWithGoogle(); }
    catch (e) { setError(friendlyError(e.code)); throw e; }
  };

  const signOut_ = () => logout();
  const resetPw  = (email) => resetPassword(email);

  const displayName = profile?.displayName || user?.displayName || user?.email?.split("@")[0] || "User";

  return (
    <AuthContext.Provider value={{ user, profile, displayName, error, setError, signIn, signUp, signInGoogle, signOut: signOut_, resetPw, loading: user === undefined }}>
      {children}
    </AuthContext.Provider>
  );
}

const friendlyError = (code) => {
  const map = {
    "auth/invalid-email":          "Invalid email address.",
    "auth/user-not-found":         "No account found with this email.",
    "auth/wrong-password":         "Incorrect password.",
    "auth/email-already-in-use":   "An account with this email already exists.",
    "auth/weak-password":          "Password should be at least 6 characters.",
    "auth/popup-closed-by-user":   "Sign-in popup was closed.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/too-many-requests":      "Too many attempts. Please try again later.",
  };
  return map[code] || "Something went wrong. Please try again.";
};
