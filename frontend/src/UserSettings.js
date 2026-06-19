import { useState } from "react";
import { THEMES } from "./themes";
import { api } from "./api";

export default function UserSettings({ T, isMobile }) {
  const theme  = T      ?? THEMES["dark"];
  const mobile = isMobile ?? false;

  const [currentPassword,  setCurrentPassword]  = useState("");
  const [newPassword,      setNewPassword]      = useState("");
  const [confirmPassword,  setConfirmPassword]  = useState("");
  const [error,            setError]            = useState("");
  const [success,          setSuccess]          = useState(false);
  const [saving,           setSaving]           = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const S = {
    card: {
      background: theme.bgCard,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      padding: mobile ? "14px" : "18px 20px",
      width: "100%",
      maxWidth: 440,
    },
    label: {
      fontFamily: "'DM Mono',monospace",
      fontSize: 9, letterSpacing: 2.5,
      color: theme.textMuted, textTransform: "uppercase",
      marginBottom: 6, display: "block",
    },
    input: {
      width: "100%", boxSizing: "border-box",
      background: theme.bgSubtle,
      border: `1px solid ${theme.border2}`,
      borderRadius: 8, padding: "10px 12px",
      color: theme.text, fontSize: 14,
      fontFamily: "inherit", outline: "none",
    },
    mono: { fontFamily: "'DM Mono',monospace" },
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: mobile ? 0 : 20 }}>
      <div style={S.card}>
        <div style={{ ...S.mono, fontSize: 9, letterSpacing: 3, color: theme.accent, textTransform: "uppercase", marginBottom: 20 }}>
          Change Password
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label htmlFor="current-password" style={S.label}>Current Password</label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              style={S.input}
              autoComplete="current-password"
            />
          </div>

          <div>
            <label htmlFor="new-password" style={S.label}>New Password</label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              style={S.input}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" style={S.label}>Confirm New Password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              style={S.input}
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div role="alert" style={{
              ...S.mono, fontSize: 10, color: theme.expense,
              padding: "8px 12px", background: theme.errorBg, borderRadius: 7,
            }}>
              {error}
            </div>
          )}

          {success && (
            <div role="status" style={{
              ...S.mono, fontSize: 10, color: theme.income,
              padding: "8px 12px", background: theme.income + "1a", borderRadius: 7,
            }}>
              Password updated successfully
            </div>
          )}

          <button type="submit" disabled={saving} style={{
            background: theme.accent, color: theme.accentText, border: "none",
            borderRadius: 9, padding: "12px", cursor: saving ? "default" : "pointer",
            fontWeight: 700, letterSpacing: 1, ...S.mono, fontSize: 11,
            opacity: saving ? 0.7 : 1,
          }}>
            {saving ? "Saving…" : "Update Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
