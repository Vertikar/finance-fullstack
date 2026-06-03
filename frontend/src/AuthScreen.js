import { useState } from "react";
import { api } from "./api";
import { THEMES, SunIcon, MoonIcon } from "./themes";

const mono = "'DM Mono', monospace";

export default function AuthScreen({ onAuth, themeKey = "dark", T, toggleTheme }) {
  // Fallback so the component is safe even if parent forgets to pass T
  const theme = T || THEMES[themeKey] || THEMES.dark;

  const [mode,     setMode]     = useState("login");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

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

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400;600&family=DM+Mono:wght@300;400;500&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .auth-input {
      background: ${theme.bgInner} !important;
      border: 1px solid ${theme.border2} !important;
      color: ${theme.text} !important;
      border-radius: 8px; padding: 10px 14px;
      font-family: 'DM Mono', monospace; font-size: 13px;
      outline: none; width: 100%; transition: border-color .2s;
    }
    .auth-input:focus { border-color: ${theme.accent} !important; }
    .auth-input::placeholder { color: ${theme.textMuted}; }
    .theme-pill {
      display: inline-flex; align-items: center; gap: 6px;
      background: ${theme.bgSubtle}; border: 1px solid ${theme.border2};
      border-radius: 20px; padding: 5px 12px 5px 8px;
      cursor: pointer; font-family: 'DM Mono', monospace;
      font-size: 10px; color: ${theme.textMid}; letter-spacing: 1px;
      transition: border-color .2s, color .2s;
    }
    .theme-pill:hover { border-color: ${theme.accent}; color: ${theme.accent}; }
  `;

  return (
    <div style={{
      fontFamily: "'Crimson Pro', Georgia, serif",
      background: theme.bg,
      minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
      color: theme.text,
      transition: "background .25s, color .25s",
    }}>
      <style>{css}</style>

      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 4, color: theme.accent, textTransform: "uppercase", marginBottom: 10 }}>
            Personal Finance
          </div>
          <div style={{ fontSize: 28, fontWeight: 300, color: theme.text }}>My Money Dashboard</div>
          {/* Theme toggle */}
          {toggleTheme && (
            <div style={{ marginTop: 16 }}>
              <button className="theme-pill" onClick={toggleTheme}
                aria-label={themeKey === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
                {themeKey === "dark"
                  ? <SunIcon color={theme.textMid} />
                  : <MoonIcon color={theme.textMid} />}
                {themeKey === "dark" ? "Light mode" : "Dark mode"}
              </button>
            </div>
          )}
        </div>

        <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, padding: "32px 30px" }}>
          {/* Mode toggle */}
          <div style={{ display: "flex", background: theme.bgInner, borderRadius: 10, padding: 4, marginBottom: 28 }}>
            {[["login", "Sign In"], ["register", "Create Account"]].map(([m, l]) => (
              <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
                flex: 1, padding: "9px", border: "none", borderRadius: 8, cursor: "pointer",
                background: mode === m ? theme.accent : "transparent",
                color: mode === m ? theme.accentText : theme.textMuted,
                fontFamily: mono, fontSize: 11, letterSpacing: 1,
                fontWeight: mode === m ? 600 : 400, transition: "all .15s",
              }}>{l}</button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 9, color: theme.textMuted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Email</div>
              <input
                className="auth-input"
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <div style={{ fontFamily: mono, fontSize: 9, color: theme.textMuted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>
                Password{mode === "register" && <span style={{ color: theme.textVeryMuted }}> (min 8 chars)</span>}
              </div>
              <input
                className="auth-input"
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div style={{ background: theme.errorBg, border: `1px solid ${theme.errorBorder}`, borderRadius: 8, padding: "10px 14px", fontFamily: mono, fontSize: 11, color: theme.expense }}>
                {error}
              </div>
            )}

            <button onClick={handleSubmit} disabled={loading} style={{
              background: loading ? theme.accent + "80" : theme.accent,
              border: "none", color: theme.accentText, borderRadius: 9, padding: "13px",
              fontFamily: mono, fontSize: 12, cursor: loading ? "wait" : "pointer",
              fontWeight: 700, letterSpacing: 1.5, marginTop: 4, transition: "background .15s",
            }}>
              {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
