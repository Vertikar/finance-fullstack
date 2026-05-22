import { useState } from "react";
import { api } from "./api";

const mono = "'DM Mono', monospace";

export default function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    if (!email || !password) { setError("Email and password are required"); return; }
    setLoading(true);
    try {
      const res = mode === "login"
        ? await api.login(email, password)
        : await api.register(email, password);
      localStorage.setItem("finance_token", res.token);
      localStorage.setItem("finance_user", JSON.stringify(res.user));
      onAuth(res.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ fontFamily: "'Crimson Pro', Georgia, serif", background: "#0b0d14", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400;600&family=DM+Mono:wght@300;400;500&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; }`}</style>
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 4, color: "#c4a24a", textTransform: "uppercase", marginBottom: 10 }}>Personal Finance</div>
          <div style={{ fontSize: 28, fontWeight: 300, color: "#ddd8cc" }}>My Money Dashboard</div>
        </div>

        <div style={{ background: "#12141e", border: "1px solid #191d2e", borderRadius: 16, padding: "32px 30px" }}>
          {/* Mode toggle */}
          <div style={{ display: "flex", background: "#0e1019", borderRadius: 10, padding: 4, marginBottom: 28 }}>
            {[["login", "Sign In"], ["register", "Create Account"]].map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
                flex: 1, padding: "9px", border: "none", borderRadius: 8, cursor: "pointer",
                background: mode === m ? "#c4a24a" : "transparent",
                color: mode === m ? "#0b0d14" : "#3a3f5a",
                fontFamily: mono, fontSize: 11, letterSpacing: 1, fontWeight: mode === m ? 600 : 400,
                transition: "all .15s"
              }}>{l}</button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 9, color: "#3a3f5a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Email</div>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                placeholder="you@example.com"
                style={{ background: "#0e101980", border: "1px solid #252840", color: "#ddd8cc", borderRadius: 8, padding: "10px 14px", fontFamily: mono, fontSize: 13, outline: "none", width: "100%" }}
              />
            </div>
            <div>
              <div style={{ fontFamily: mono, fontSize: 9, color: "#3a3f5a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Password {mode === "register" && <span style={{ color: "#252840" }}>(min 8 chars)</span>}</div>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                placeholder="••••••••"
                style={{ background: "#0e101980", border: "1px solid #252840", color: "#ddd8cc", borderRadius: 8, padding: "10px 14px", fontFamily: mono, fontSize: 13, outline: "none", width: "100%" }}
              />
            </div>

            {error && (
              <div style={{ background: "#2a1010", border: "1px solid #f8717133", borderRadius: 8, padding: "10px 14px", fontFamily: mono, fontSize: 11, color: "#f87171" }}>
                {error}
              </div>
            )}

            <button onClick={handleSubmit} disabled={loading} style={{
              background: loading ? "#7a6a30" : "#c4a24a", border: "none", color: "#0b0d14",
              borderRadius: 9, padding: "13px", fontFamily: mono, fontSize: 12,
              cursor: loading ? "wait" : "pointer", fontWeight: 700, letterSpacing: 1.5,
              marginTop: 4, transition: "background .15s"
            }}>
              {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
