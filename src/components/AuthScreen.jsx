src/components/AuthScreen.jsx
import { useState } from "react";
import { useAuth } from "../context/AuthContext";

const pwStrength = (p) => {
  let s = 0;
  if (p.length >= 8) s++;
  if (/[A-Z]/.test(p)) s++;
  if (/[0-9]/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return s;
};
const STRENGTH_COLORS = ["#ff4d6d", "#ff4d6d", "#f0a500", "#00e49a", "#00e49a"];
const STRENGTH_LABELS = ["", "Weak", "Fair", "Strong", "Very Strong"];

export default function AuthScreen() {
  const { signIn, signUp, signInGoogle, resetPw, error, setError } = useAuth();
  const [view,     setView]     = useState("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [name,     setName]     = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [sent,     setSent]     = useState(false);
  const [strength, setStrength] = useState(0);

  const handle = async (fn, ...args) => {
    setLoading(true);
    setError(null);
    try { await fn(...args); }
    catch (_) {}
    setLoading(false);
  };

  const FloatingInput = ({ label, value, onChange, type = "text", placeholder, autoComplete, right }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
      <div style={{ position: "relative" }}>
        <input
          value={value} onChange={onChange} type={type}
          placeholder={placeholder} autoComplete={autoComplete}
          style={{ width: "100%", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", color: "var(--text)", fontFamily: "'Syne',sans-serif", fontSize: 13, outline: "none", transition: "border-color .2s" }}
          onFocus={e => e.target.style.borderColor = "rgba(240,165,0,0.5)"}
          onBlur={e => e.target.style.borderColor = "var(--border)"}
        />
        {right}
      </div>
    </div>
  );

  const EyeBtn = () => (
    <button type="button" onClick={() => setShowPw(p => !p)}
      style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}>
      {showPw ? "🙈" : "👁"}
    </button>
  );

  const SubmitBtn = ({ label, loadLabel }) => (
    <button type="button" onClick={() => {
      if (view === "login")    handle(signIn, email, password);
      if (view === "register") handle(signUp, email, password, name);
      if (view === "forgot")   handle(async () => { await resetPw(email); setSent(true); });
    }} disabled={loading}
      style={{ width: "100%", padding: 14, background: loading ? "var(--bg4)" : "linear-gradient(135deg,#f0a500,#ffc333)", border: "none", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, color: loading ? "var(--muted)" : "#000", boxShadow: loading ? "none" : "0 4px 20px rgba(240,165,0,0.3)", transition: "all .2s" }}>
      {loading ? loadLabel : label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse 80% 60% at 50% -10%,rgba(240,165,0,0.12),transparent),var(--bg)", padding: 20 }}>
      {/* BG orbs */}
      <div style={{ position: "fixed", top: "10%", left: "5%",  width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle,rgba(240,165,0,0.04),transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: "5%", right: "10%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle,rgba(99,78,234,0.05),transparent 70%)", pointerEvents: "none" }} />

      <div style={{ width: "100%", maxWidth: 440 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, background: "linear-gradient(135deg,#f0a500,#ffc333)", borderRadius: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, color: "#000", marginBottom: 12, boxShadow: "0 8px 32px rgba(240,165,0,0.3)" }}>◈</div>
          <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: 1 }}>AURUM</div>
          <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 2, marginTop: 2 }}>CRYPTO PLATFORM</div>
        </div>

        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 20, padding: 32, boxShadow: "0 24px 80px rgba(0,0,0,0.4)" }}>
          {/* Error banner */}
          {error && (
            <div style={{ background: "rgba(255,77,109,0.1)", border: "1px solid rgba(255,77,109,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#ff4d6d", display: "flex", gap: 8, alignItems: "center" }}>
              <span>⚠</span>{error}
            </div>
          )}

          {view === "login" && (<>
            <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>Welcome back</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>Sign in to your account</div>

            <FloatingInput label="Email" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" autoComplete="email" />
            <FloatingInput label="Password" value={password} onChange={e => setPassword(e.target.value)} type={showPw ? "text" : "password"} placeholder="••••••••" autoComplete="current-password" right={<EyeBtn />} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>
                <input type="checkbox" style={{ accentColor: "var(--gold)" }} /> Remember me
              </label>
              <span onClick={() => { setView("forgot"); setError(null); }} style={{ fontSize: 12, color: "var(--gold)", cursor: "pointer" }}>Forgot password?</span>
            </div>

            <SubmitBtn label="Sign In →" loadLabel="Signing in…" />

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ fontSize: 11, color: "var(--muted)" }}>or</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>

            <button type="button" onClick={() => handle(signInGoogle)} disabled={loading}
              style={{ width: "100%", padding: 12, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer", fontFamily: "'Syne',sans-serif", fontWeight: 600, fontSize: 13, color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "border-color .2s" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(240,165,0,0.3)"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Continue with Google
            </button>

            <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--muted)" }}>
              No account?{" "}
              <span onClick={() => { setView("register"); setError(null); }} style={{ color: "var(--gold)", cursor: "pointer", fontWeight: 700 }}>Sign up free</span>
            </div>
          </>)}

          {view === "register" && (<>
            <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>Create account</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>Join 2.4M+ traders on Aurum</div>

            <FloatingInput label="Full Name" value={name} onChange={e => setName(e.target.value)} placeholder="Alex Morgan" autoComplete="name" />
            <FloatingInput label="Email" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" autoComplete="email" />

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>Password</div>
              <div style={{ position: "relative" }}>
                <input value={password} onChange={e => { setPassword(e.target.value); setStrength(pwStrength(e.target.value)); }}
                  type={showPw ? "text" : "password"} placeholder="Min 8 characters" autoComplete="new-password"
                  style={{ width: "100%", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 44px 12px 14px", color: "var(--text)", fontFamily: "'Syne',sans-serif", fontSize: 13, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = "rgba(240,165,0,0.5)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"} />
                <EyeBtn />
              </div>
              {password && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= strength ? STRENGTH_COLORS[strength] : "var(--bg4)", transition: "background .3s" }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: STRENGTH_COLORS[strength] }}>{STRENGTH_LABELS[strength]}</div>
                </div>
              )}
            </div>

            <FloatingInput label="Confirm Password" value={confirm} onChange={e => setConfirm(e.target.value)} type="password" placeholder="Repeat password" autoComplete="new-password" />

            {confirm && confirm !== password && (
              <div style={{ fontSize: 11, color: "var(--red)", marginTop: -10, marginBottom: 12 }}>Passwords don't match</div>
            )}

            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 12, color: "var(--muted)", marginBottom: 20 }}>
              <input type="checkbox" style={{ accentColor: "var(--gold)", marginTop: 2 }} />
              I agree to the <span style={{ color: "var(--gold)" }}>Terms of Service</span> and <span style={{ color: "var(--gold)" }}>Privacy Policy</span>
            </label>

            <SubmitBtn label="Create Account →" loadLabel="Creating account…" />

            <div style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--muted)" }}>
              Have an account?{" "}
              <span onClick={() => { setView("login"); setError(null); }} style={{ color: "var(--gold)", cursor: "pointer", fontWeight: 700 }}>Sign in</span>
            </div>
          </>)}

          {view === "forgot" && (<>
            {!sent ? (<>
              <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>Reset password</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 24 }}>We'll email you a reset link</div>
              <FloatingInput label="Email" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" autoComplete="email" />
              <SubmitBtn label="Send Reset Link" loadLabel="Sending…" />
            </>) : (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
                <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Check your inbox</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Sent a reset link to <strong style={{ color: "var(--gold)" }}>{email}</strong></div>
              </div>
            )}
            <div style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
              <span onClick={() => { setView("login"); setSent(false); setError(null); }} style={{ color: "var(--gold)", cursor: "pointer" }}>← Back to login</span>
            </div>
          </>)}

          {/* Security badges */}
          <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
            {["🔒 256-bit SSL", "🛡 2FA Protected", "❄ Cold Storage"].map(b => (
              <span key={b} style={{ fontSize: 10, color: "var(--muted)" }}>{b}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
