import { useState, useRef, useCallback } from "react";
import { api } from "./api";
import { THEMES } from "./themes";

// ── Constants ──────────────────────────────────────────────────────────────────
const REQUIRED_COLS   = ["name", "amount", "type", "frequency", "category", "next_due"];
const MAX_PREVIEW_ROWS = 10;
const MAX_IMPORT_ROWS  = 1000;

// ── CSV parser ─────────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) break;
    if (line[i] === '"') {
      i++;
      let field = "";
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
      fields.push(field.trim());
      if (line[i] === ",") i++;
    } else {
      const start = i;
      while (i < line.length && line[i] !== ",") i++;
      fields.push(line.slice(start, i).trim());
      if (i < line.length) i++;
    }
  }
  if (line.endsWith(",")) fields.push("");
  return fields;
}

function parseCSVText(text) {
  const normalised = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalised.split("\n").filter(l => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  const rows = lines.slice(1, MAX_IMPORT_ROWS + 1).map(line => {
    const vals = parseCSVLine(line);
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
  return { headers, rows, totalLines: lines.length - 1 };
}

// ── Template download ──────────────────────────────────────────────────────────
function downloadTemplate() {
  const rows = [
    REQUIRED_COLS.join(","),
    "Monthly Rent,2000.00,expense,monthly,Housing,2026-07-01",
    "Salary,6500.00,income,monthly,Salary,2026-07-15",
    "Netflix,19.99,expense,monthly,Subscriptions,2026-07-05",
    "Car Loan,450.00,expense,fortnightly,Transport,2026-07-04",
  ].join("\n");
  const blob = new Blob([rows], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "finance-import-template.csv";
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function ImportModal({ onClose, onImported, T: TProp, themeKey = "dark" }) {
  // Support passing T directly (preferred) or falling back to THEMES lookup
  const T = TProp || THEMES[themeKey] || THEMES.dark;

  const mono  = "'DM Mono', monospace";
  const serif = "'Crimson Pro', Georgia, serif";

  // Styles computed from theme tokens
  const S = {
    overlay: {
      position: "fixed", inset: 0, background: T.modalOverlay,
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 300, padding: 24,
    },
    box: {
      background: T.bgCard, border: `1px solid ${T.border2}`,
      borderRadius: 16, padding: "28px 30px",
      width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto",
      fontFamily: serif, color: T.text,
    },
    sectionLabel: {
      fontFamily: mono, fontSize: 9, letterSpacing: 2.5,
      color: T.textMuted, textTransform: "uppercase", marginBottom: 8,
    },
    errorBox: {
      background: T.errorBg, border: `1px solid ${T.errorBorder}`,
      borderRadius: 8, padding: "10px 14px",
      fontFamily: mono, fontSize: 11, color: T.expense, marginTop: 12,
    },
    btn: {
      cancel: {
        flex: 1, background: T.bgSubtle, border: `1px solid ${T.border2}`,
        color: T.textMid, borderRadius: 9, padding: "12px",
        fontFamily: mono, fontSize: 11, cursor: "pointer",
      },
      primary: {
        flex: 2, background: T.accent, border: "none", color: T.accentText,
        borderRadius: 9, padding: "12px", fontFamily: mono, fontSize: 11,
        cursor: "pointer", fontWeight: 700, letterSpacing: 1,
      },
      disabled: {
        flex: 2, background: T.accent + "60", border: "none",
        color: T.accentText + "80", borderRadius: 9, padding: "12px",
        fontFamily: mono, fontSize: 11, cursor: "not-allowed",
      },
      ghost: {
        background: "none", border: "none",
        fontFamily: mono, fontSize: 10, color: T.textMuted, cursor: "pointer", padding: 0,
      },
    },
  };

  const [phase,    setPhase]    = useState("idle");
  const [file,     setFile]     = useState(null);
  const [preview,  setPreview]  = useState(null);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = useCallback(f => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) { setError("Please select a .csv file."); return; }
    setError(""); setFile(f);
    const reader = new FileReader();
    reader.onload = e => {
      const { headers, rows, totalLines } = parseCSVText(e.target.result);
      const missing = REQUIRED_COLS.filter(c => !headers.includes(c));
      if (missing.length > 0) { setError(`Missing required columns: ${missing.join(", ")}`); setFile(null); return; }
      setPreview({ headers, rows, totalLines }); setPhase("preview");
    };
    reader.onerror = () => setError("Could not read the file.");
    reader.readAsText(f, "utf-8");
  }, []);

  const handleDrop = useCallback(e => {
    e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  function resetToIdle() { setPhase("idle"); setFile(null); setPreview(null); setError(""); }

  async function doImport() {
    setPhase("importing"); setError("");
    try {
      const res = await api.importEntries(file);
      setResult(res); setPhase("done");
      if (res.imported > 0) onImported();
    } catch (e) { setError(e.message); setPhase("preview"); }
  }

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.box}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 3, color: T.accent, textTransform: "uppercase", marginBottom: 6 }}>
              CSV Import
            </div>
            <div style={{ fontSize: 20, fontWeight: 300 }}>
              {phase === "done" ? "Import Complete" : "Upload Entries"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textMuted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {/* Phase: idle — drop zone */}
        {phase === "idle" && (
          <>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? T.accent : T.border2}`,
                borderRadius: 12, padding: "36px 24px", textAlign: "center",
                cursor: "pointer", transition: "border-color .2s, background .2s",
                background: dragOver ? T.accent + "08" : "transparent",
                userSelect: "none",
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>⬆︎</div>
              <div style={{ fontSize: 16, marginBottom: 6 }}>Drop a CSV file here, or click to browse</div>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.textMuted, lineHeight: 1.7 }}>
                Required columns: {REQUIRED_COLS.join(", ")}
              </div>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />

            <div style={{ marginTop: 14, background: T.bgInner, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={S.sectionLabel}>Example CSV</div>
                <button onClick={downloadTemplate} style={{ ...S.btn.ghost, color: T.accent, fontSize: 10 }}>↓ Download template</button>
              </div>
              <pre style={{ fontFamily: mono, fontSize: 10, color: T.textMuted, lineHeight: 1.9, margin: 0, overflowX: "auto" }}>
{`name,amount,type,frequency,category,next_due
Monthly Rent,2000.00,expense,monthly,Housing,2026-07-01
Salary,6500.00,income,monthly,Salary,2026-07-15`}
              </pre>
            </div>

            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { col: "type",      values: "income · expense" },
                { col: "frequency", values: "weekly · fortnightly · monthly · quarterly · biannual · yearly" },
                { col: "amount",    values: "positive number, e.g. 1500.00" },
                { col: "next_due",  values: "YYYY-MM-DD, e.g. 2026-07-01" },
              ].map(({ col, values }) => (
                <div key={col} style={{ background: T.bgInner, borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontFamily: mono, fontSize: 9, color: T.accent, letterSpacing: 1.5, marginBottom: 4 }}>{col}</div>
                  <div style={{ fontFamily: mono, fontSize: 9, color: T.textMuted, lineHeight: 1.6 }}>{values}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Phase: preview */}
        {phase === "preview" && preview && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.textMid }}>
                <span style={{ color: T.text, fontWeight: 500 }}>{preview.totalLines}</span>
                {" row"}{preview.totalLines !== 1 ? "s" : ""} in{" "}
                <span style={{ color: T.accent }}>{file?.name}</span>
                {preview.totalLines > MAX_IMPORT_ROWS && (
                  <span style={{ color: T.expense }}>{" "}— only the first {MAX_IMPORT_ROWS} will be imported</span>
                )}
              </div>
              <button onClick={resetToIdle} style={S.btn.ghost}>← Change file</button>
            </div>

            <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${T.border}`, marginBottom: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: mono, fontSize: 10 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    {REQUIRED_COLS.map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: T.textMuted, letterSpacing: 1.5, textTransform: "uppercase", whiteSpace: "nowrap", fontWeight: 400 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, MAX_PREVIEW_ROWS).map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? T.bgInner : "transparent" }}>
                      {REQUIRED_COLS.map(col => {
                        const val = row[col] || "";
                        const color =
                          col === "type"   ? (val === "income" ? T.income : val === "expense" ? T.expense : T.textMuted)
                          : col === "amount" ? T.text
                          : T.textMid;
                        return (
                          <td key={col} style={{ padding: "8px 12px", color, whiteSpace: "nowrap" }}>
                            {val || <span style={{ color: T.textVeryMuted }}>—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.totalLines > MAX_PREVIEW_ROWS && (
              <div style={{ fontFamily: mono, fontSize: 10, color: T.textMuted, textAlign: "center", marginBottom: 14 }}>
                … and {preview.totalLines - MAX_PREVIEW_ROWS} more row{preview.totalLines - MAX_PREVIEW_ROWS !== 1 ? "s" : ""}
              </div>
            )}
          </>
        )}

        {/* Phase: done */}
        {phase === "done" && result && (
          <div>
            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1, background: T.bgInner, borderRadius: 10, padding: "18px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: mono, fontSize: 28, color: T.income, fontWeight: 500 }}>{result.imported}</div>
                <div style={{ fontFamily: mono, fontSize: 9, color: T.textMuted, letterSpacing: 2, textTransform: "uppercase", marginTop: 6 }}>Imported</div>
              </div>
              <div style={{ flex: 1, background: T.bgInner, borderRadius: 10, padding: "18px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: mono, fontSize: 28, color: result.skipped > 0 ? T.expense : T.textMuted, fontWeight: 500 }}>{result.skipped}</div>
                <div style={{ fontFamily: mono, fontSize: 9, color: T.textMuted, letterSpacing: 2, textTransform: "uppercase", marginTop: 6 }}>Skipped</div>
              </div>
            </div>

            {result.errors?.length > 0 && (
              <>
                <div style={S.sectionLabel}>Skipped rows</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflowY: "auto" }}>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ background: T.errorBg, border: `1px solid ${T.errorBorder}`, borderRadius: 7, padding: "8px 12px", fontFamily: mono, fontSize: 10, color: T.expense }}>
                      <span style={{ color: T.expense + "aa" }}>Row {e.row}:</span> {e.message}
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.imported === 0 && result.skipped === 0 && (
              <div style={{ fontFamily: mono, fontSize: 11, color: T.textMuted, textAlign: "center", padding: 20 }}>
                The file contained no data rows.
              </div>
            )}
          </div>
        )}

        {error && <div style={S.errorBox}>⚠ {error}</div>}

        {/* Footer actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={onClose} style={S.btn.cancel}>{phase === "done" ? "Close" : "Cancel"}</button>
          {phase === "preview" && (
            <button onClick={doImport} style={S.btn.primary}>
              Import {preview?.rows.slice(0, MAX_IMPORT_ROWS).length} entr{preview?.rows.length !== 1 ? "ies" : "y"}
            </button>
          )}
          {phase === "importing" && <button disabled style={S.btn.disabled}>Importing…</button>}
        </div>
      </div>
    </div>
  );
}
