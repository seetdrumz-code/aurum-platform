// src/AppRouter.jsx
import { useAuth } from "./context/AuthContext";
import AuthScreen from "./components/AuthScreen";
import Platform from "./Platform";

export default function AppRouter() {
  const { user, loading } = useAuth();

  // Loading state — firebase is resolving session
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 44, height: 44, border: "3px solid var(--bg4)", borderTop: "3px solid var(--gold)", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading Aurum…</div>
        </div>
      </div>
    );
  }

  // Not authenticated — show auth screen
  if (!user) return <AuthScreen />;

  // Authenticated — show platform
  return <Platform />;
}
