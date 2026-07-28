import { useState, useEffect, useCallback } from "react";
import { api } from "./api";
import { THEMES } from "./themes";

const PLACEHOLDER = "—";
const UNAVAILABLE = "unavailable";

// Values that carry no build identity. A commit of "unknown" can't be compared
// against the API's, so the mismatch hint stays hidden rather than firing on
// two builds that are merely both unlabelled.
const UNIDENTIFIED = ["", "unknown", UNAVAILABLE];

function isIdentified(commit) {
  return !UNIDENTIFIED.includes(commit);
}

/**
 * The web bundle's own build info.
 *
 * CRA inlines REACT_APP_* at build time (see frontend/Dockerfile), so in a real
 * build these are string literals rather than a live environment lookup — the
 * substitution is textual and applies here inside the function just as it would
 * at module scope. Read at call time rather than on import so tests can stub the
 * env without re-importing the module (which would hand the component a second
 * React instance and break hooks).
 *
 * The fallbacks are what `npm start` and the Jest suite see; without them the
 * dialog would render "undefined".
 */
export function getWebBuildInfo() {
  return {
    version:   process.env.REACT_APP_VERSION    || "dev",
    commit:    process.env.REACT_APP_COMMIT     || "unknown",
    buildTime: process.env.REACT_APP_BUILD_TIME || "",
  };
}

/**
 * Render an ISO build timestamp in the user's locale. Falls back to the raw
 * string if it isn't parseable — a wrong-looking date is more useful in a bug
 * report than a swallowed one.
 */
export function formatBuildTime(iso) {
  if (!iso) return PLACEHOLDER;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-AU", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * About dialog — the running build of both halves of the app.
 *
 * Shows the web bundle's version/commit/build-time alongside the API's, because
 * the two are built and deployed independently and a mismatch between them is
 * the failure this dialog exists to make visible.
 */
export default function About({ T: TProp, isMobile = false, onClose, themeKey = "dark" }) {
  const T = TProp || THEMES[themeKey] || THEMES.dark;

  const web = getWebBuildInfo();

  const mono  = "'DM Mono', monospace";
  const serif = "'Crimson Pro', Georgia, serif";

  // null while in flight; an object once resolved or failed. `failed` is tracked
  // on the object rather than as a separate error state because the render only
  // ever needs to know "do I have API values or not".
  const [apiInfo, setApiInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getVersion()
      .then(data => { if (!cancelled) setApiInfo({ ...data, failed: false }); })
      // A failed fetch must not blank the dialog. The frontend block is already
      // known locally and is half the point of opening it, so degrade to
      // "unavailable" on the API rows and render everything else.
      .catch(()   => { if (!cancelled) setApiInfo({ failed: true }); });
    return () => { cancelled = true; };
  }, []);

  // Escape to close. The existing Add/Edit and Import modals don't do this;
  // applying it to them is tracked as a follow-up rather than done here.
  useEffect(() => {
    const onKeyDown = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const loading = apiInfo === null;
  const failed  = !loading && apiInfo.failed;

  const apiVersion   = loading ? "…" : failed ? UNAVAILABLE : (apiInfo.version || "dev");
  const apiCommit    = loading ? "…" : failed ? UNAVAILABLE : (apiInfo.commit  || "unknown");
  const apiBuildTime = loading ? "…" : failed ? UNAVAILABLE : formatBuildTime(apiInfo.build_time);
  const apiGoVersion = loading ? "…" : failed ? UNAVAILABLE : (apiInfo.go_version || PLACEHOLDER);

  const mismatch =
    !loading && !failed &&
    isIdentified(web.commit) && isIdentified(apiCommit) && web.commit !== apiCommit;

  // navigator.clipboard is absent in jsdom and on non-HTTPS origins — hide the
  // button rather than offer one that throws.
  const canCopy =
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function";

  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const block = [
      "App version:  " + web.version,
      "App commit:   " + web.commit,
      "App built:    " + (web.buildTime || PLACEHOLDER),
      "API version:  " + apiVersion,
      "API commit:   " + apiCommit,
      "API built:    " + (failed || loading ? apiBuildTime : (apiInfo.build_time || PLACEHOLDER)),
      "API Go:       " + apiGoVersion,
    ].join("\n");
    navigator.clipboard.writeText(block).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }, [web, apiInfo, apiVersion, apiCommit, apiBuildTime, apiGoVersion, failed, loading]);

  // ── Styles ──────────────────────────────────────────────────────────────────
  // Mirrors the Add/Edit modal in App.js so there is one visual language: same
  // overlay token, same zIndex, same bottom-sheet treatment on mobile.
  const S = {
    overlay: {
      position: "fixed", inset: 0, background: T.modalOverlay,
      display: "flex", alignItems: isMobile ? "flex-end" : "center",
      justifyContent: "center", zIndex: 200, padding: isMobile ? 0 : 24,
    },
    box: {
      background: T.bgCard, border: `1px solid ${T.border2}`,
      borderRadius: isMobile ? "16px 16px 0 0" : 16,
      padding: "24px 22px", width: "100%", maxWidth: isMobile ? "100%" : 460,
      fontFamily: serif, color: T.text,
      ...(isMobile ? {
        maxHeight: "92dvh", overflowY: "auto",
        // Clears the iOS home indicator — the copy/close row is the last thing
        // in the sheet, so without this it sits under the gesture bar.
        paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
      } : {}),
    },
    title: {
      fontFamily: mono, fontSize: 9, letterSpacing: 3, color: T.accent,
      textTransform: "uppercase", marginBottom: 20,
    },
    groupLabel: {
      fontFamily: mono, fontSize: 9, letterSpacing: 2.5, color: T.textMuted,
      textTransform: "uppercase", marginBottom: 8, display: "block",
    },
    group: {
      background: T.bgInner, borderRadius: 9, padding: "12px 14px",
      display: "flex", flexDirection: "column", gap: 7,
    },
    row: {
      display: "flex", justifyContent: "space-between",
      alignItems: "baseline", gap: 12,
    },
    rowLabel: { fontFamily: mono, fontSize: 10, color: T.textMuted },
    rowValue: {
      fontFamily: mono, fontSize: 11, color: T.text,
      textAlign: "right", wordBreak: "break-all",
    },
    mismatch: {
      fontFamily: mono, fontSize: 10, color: T.warn, lineHeight: 1.6,
      background: T.bgSubtle, border: `1px solid ${T.border2}`,
      borderRadius: 8, padding: "10px 14px", marginTop: 14,
    },
    btnRow: { display: "flex", gap: 10, marginTop: 20 },
    btnSecondary: {
      flex: 1, background: T.bgSubtle, border: `1px solid ${T.border2}`,
      color: T.textMid, borderRadius: 9, padding: "12px",
      fontFamily: mono, fontSize: 11, cursor: "pointer",
    },
    btnPrimary: {
      flex: 1, background: T.accent, border: "none", color: T.accentText,
      borderRadius: 9, padding: "12px", fontFamily: mono, fontSize: 11,
      cursor: "pointer", fontWeight: 700, letterSpacing: 1,
    },
  };

  const Row = ({ label, value }) => (
    <div style={S.row}>
      <span style={S.rowLabel}>{label}</span>
      <span style={S.rowValue}>{value}</span>
    </div>
  );

  return (
    <div
      style={S.overlay}
      data-testid="about-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={S.box}
        role="dialog"
        aria-modal="true"
        aria-label="About this app"
        // Clicks inside the card must not reach the overlay's dismiss handler.
        onClick={e => e.stopPropagation()}
      >
        <div style={S.title}>About</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <span style={S.groupLabel}>App</span>
            <div style={S.group}>
              <Row label="Version" value={web.version} />
              <Row label="Commit"  value={web.commit} />
              <Row label="Built"   value={formatBuildTime(web.buildTime)} />
            </div>
          </div>

          <div>
            <span style={S.groupLabel}>API</span>
            <div style={S.group}>
              <Row label="Version" value={apiVersion} />
              <Row label="Commit"  value={apiCommit} />
              <Row label="Built"   value={apiBuildTime} />
              <Row label="Go"      value={apiGoVersion} />
            </div>
          </div>
        </div>

        {mismatch && (
          <div style={S.mismatch}>
            The web app and API are from different builds. Rebuild both
            (<span style={{ color: T.text }}>make up</span>) if that isn't intentional.
          </div>
        )}

        <div style={S.btnRow}>
          {canCopy && (
            <button onClick={handleCopy} style={S.btnSecondary}>
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          <button onClick={onClose} style={S.btnPrimary}>Close</button>
        </div>
      </div>
    </div>
  );
}
