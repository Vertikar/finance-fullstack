import { useState, useRef, useCallback } from "react";
import { api } from "./api";

// ── Constants ──────────────────────────────────────────────────────────────────

const REQUIRED_COLS = ["name", "amount", "type", "frequency", "category", "next_due"];
const MAX_PREVIEW_ROWS = 10;
const MAX_IMPORT_ROWS = 1000;

// ── CSV parser ─────────────────────────────────────────────────────────────────

/**
 * Parse a single CSV line according to RFC 4180.
 * Handles quoted fields, escaped double-quotes, and trailing commas.
 */
function parseCSVLine(line) {
  const fields = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      // End of line — the trailing comma case already pushed; break here
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      i++;
      let field = "";
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"'; // escaped double-quote
          i += 2;
        } else if (line[i] === '"') {
          i++; // closing quote
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field.trim());
      if (line[i] === ",") i++;
    } else {
      // Unquoted field — read to next comma or end of line
      const start = i;
      while (i < line.length && line[i] !== ",") i++;
      fields.push(line.slice(start, i).trim());
      if (i < line.length) i++; // skip comma
    }
  }

  // If the line ended with a comma, push an empty trailing field
  if (line.endsWith(",")) fields.push("");

  return fields;
}

/**
 * Parse CSV text into { headers, rows }.
 * headers is a lower-cased string array.
 * rows is an array of plain objects keyed by header name.
 */
function parseCSVText(text) {
  const normalised = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalised.split("\n").filter((l) => l.trim() !== "");

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  const rows = lines.slice(1, MAX_IMPORT_ROWS + 1).map((line) => {
    const vals = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = vals[i] ?? "";
    });
    return obj;
  });

  return { headers, rows, totalLines: lines.length - 1 };
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const mono = "'DM Mono', monospace";
const serif = "'Crimson Pro', Georgia, serif";

const S = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(5,6,12,0.88)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 300,
    padding: 24,
  },
  box: {
    background: "#12141e",
    border: "1px solid #252840",
    borderRadius: 16,
    padding: "28px 30px",
    width: "100%",
    maxWidth: 620,
    maxHeight: "90vh",
    overflowY: "auto",
    fontFamily: serif,
    color: "#ddd8cc",
  },
  sectionLabel: {
    fontFamily: mono,
    fontSize: 9,
    letterSpacing: 2.5,
    color: "#3a3f5a",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  errorBox: {
    background: "#2a1010",
    border: "1px solid #f8717133",
    borderRadius: 8,
    padding: "10px 14px",
    fontFamily: mono,
    fontSize: 11,
    color: "#f87171",
    marginTop: 12,
  },
  btn: {
    cancel: {
      flex: 1,
      background: "#191d2e",
      border: "1px solid #252840",
      color: "#7a8299",
      borderRadius: 9,
      padding: "12px",
      fontFamily: mono,
      fontSize: 11,
      cursor: "pointer",
    },
    primary: {
      flex: 2,
      background: "#c4a24a",
      border: "none",
      color: "#0b0d14",
      borderRadius: 9,
      padding: "12px",
      fontFamily: mono,
      fontSize: 11,
      cursor: "pointer",
      fontWeight: 700,
      letterSpacing: 1,
    },
    disabled: {
      flex: 2,
      background: "#7a6a30",
      border: "none",
      color: "#0b0d1480",
      borderRadius: 9,
      padding: "12px",
      fontFamily: mono,
      fontSize: 11,
      cursor: "not-allowed",
    },
    ghost: {
      background: "none",
      border: "none",
      fontFamily: mono,
      fontSize: 10,
      color: "#3a3f5a",
      cursor: "pointer",
      padding: 0,
    },
  },
};

// ── Template download (no network needed) ──────────────────────────────────────

function downloadTemplate() {
  const rows = [
    REQUIRED_COLS.join(","),
    "Monthly Rent,2000.00,expense,monthly,Housing,2026-07-01",
    "Salary,6500.00,income,monthly,Salary,2026-07-15",
    "Netflix,19.99,expense,monthly,Subscriptions,2026-07-05",
    "Car Loan,450.00,expense,fortnightly,Transport,2026-07-04",
  ].join("\n");

  const blob = new Blob([rows], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "finance-import-template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * ImportModal
 *
 * Props:
 *   onClose()          — called when the user cancels or closes after finishing
 *   onImported()       — called when at least one row was successfully imported
 *                        so the parent can refresh its entry list
 */
export default function ImportModal({ onClose, onImported }) {
  const [phase, setPhase] = useState("idle"); // idle | preview | importing | done
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // { headers, rows, totalLines }
  const [result, setResult] = useState(null);   // ImportResult from the API
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // ── File handling ────────────────────────────────────────────────────────────

  const handleFile = useCallback((f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("Please select a .csv file.");
      return;
    }
    setError("");
    setFile(f);

    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers, rows, totalLines } = parseCSVText(e.target.result);

      const missing = REQUIRED_COLS.filter((c) => !headers.includes(c));
      if (missing.length > 0) {
        setError(`Missing required columns: ${missing.join(", ")}`);
        setFile(null);
        return;
      }

      setPreview({ headers, rows, totalLines });
      setPhase("preview");
    };
    reader.onerror = () => setError("Could not read the file.");
    reader.readAsText(f, "utf-8");
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      handleFile(e.dataTransfer.files[0]);
    },
    [handleFile]
  );

  function resetToIdle() {
    setPhase("idle");
    setFile(null);
    setPreview(null);
    setError("");
  }

  // ── Import ───────────────────────────────────────────────────────────────────

  async function doImport() {
    setPhase("importing");
    setError("");
    try {
      const res = await api.importEntries(file);
      setResult(res);
      setPhase("done");
      if (res.imported > 0) onImported();
    } catch (e) {
      setError(e.message);
      setPhase("preview");
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={S.box}>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 3, color: "#c4a24a", textTransform: "uppercase", marginBottom: 6 }}>
              CSV Import
            </div>
            <div style={{ fontSize: 20, fontWeight: 300 }}>
              {phase === "done" ? "Import Complete" : "Upload Entries"}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#3a3f5a", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>
            ×
          </button>
        </div>

        {/* ── Phase: idle — drop zone ── */}
        {phase === "idle" && (
          <>
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "#c4a24a" : "#252840"}`,
                borderRadius: 12,
                padding: "36px 24px",
                textAlign: "center",
                cursor: "pointer",
                transition: "border-color .2s, background .2s",
                background: dragOver ? "#c4a24a08" : "transparent",
                userSelect: "none",
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>⬆︎</div>
              <div style={{ fontSize: 16, marginBottom: 6 }}>
                Drop a CSV file here, or click to browse
              </div>
              <div style={{ fontFamily: mono, fontSize: 10, color: "#3a3f5a", lineHeight: 1.7 }}>
                Required columns: {REQUIRED_COLS.join(", ")}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files[0])}
            />

            {/* Format reference + template download */}
            <div style={{ marginTop: 14, background: "#0e1019", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={S.sectionLabel}>Example CSV</div>
                <button onClick={downloadTemplate} style={{ ...S.btn.ghost, color: "#c4a24a", fontSize: 10 }}>
                  ↓ Download template
                </button>
              </div>
              <pre style={{ fontFamily: mono, fontSize: 10, color: "#3a3f5a", lineHeight: 1.9, margin: 0, overflowX: "auto" }}>
{`name,amount,type,frequency,category,next_due
Monthly Rent,2000.00,expense,monthly,Housing,2026-07-01
Salary,6500.00,income,monthly,Salary,2026-07-15`}
              </pre>
            </div>

            {/* Field reference */}
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                { col: "type", values: "income · expense" },
                { col: "frequency", values: "weekly · fortnightly · monthly · quarterly · yearly" },
                { col: "amount", values: "positive number, e.g. 1500.00" },
                { col: "next_due", values: "YYYY-MM-DD, e.g. 2026-07-01" },
              ].map(({ col, values }) => (
                <div key={col} style={{ background: "#0e1019", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ fontFamily: mono, fontSize: 9, color: "#c4a24a", letterSpacing: 1.5, marginBottom: 4 }}>{col}</div>
                  <div style={{ fontFamily: mono, fontSize: 9, color: "#3a3f5a", lineHeight: 1.6 }}>{values}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Phase: preview ── */}
        {phase === "preview" && preview && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: "#7a8299" }}>
                <span style={{ color: "#ddd8cc", fontWeight: 500 }}>{preview.totalLines}</span>
                {" row"}
                {preview.totalLines !== 1 ? "s" : ""} in{" "}
                <span style={{ color: "#c4a24a" }}>{file?.name}</span>
                {preview.totalLines > MAX_IMPORT_ROWS && (
                  <span style={{ color: "#f87171" }}>
                    {" "}— only the first {MAX_IMPORT_ROWS} will be imported
                  </span>
                )}
              </div>
              <button onClick={resetToIdle} style={S.btn.ghost}>
                ← Change file
              </button>
            </div>

            {/* Preview table */}
            <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #191d2e", marginBottom: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: mono, fontSize: 10 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #191d2e" }}>
                    {REQUIRED_COLS.map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "#3a3f5a", letterSpacing: 1.5, textTransform: "uppercase", whiteSpace: "nowrap", fontWeight: 400 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, MAX_PREVIEW_ROWS).map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#0e1019" : "transparent", borderBottom: "1px solid #13162200" }}>
                      {REQUIRED_COLS.map((col) => {
                        const val = row[col] || "";
                        const color =
                          col === "type"
                            ? val === "income" ? "#4ade80" : val === "expense" ? "#f87171" : "#3a3f5a"
                            : col === "amount"
                            ? "#ddd8cc"
                            : "#7a8299";
                        return (
                          <td key={col} style={{ padding: "8px 12px", color, whiteSpace: "nowrap" }}>
                            {val || <span style={{ color: "#2e3350" }}>—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.totalLines > MAX_PREVIEW_ROWS && (
              <div style={{ fontFamily: mono, fontSize: 10, color: "#3a3f5a", textAlign: "center", marginBottom: 14 }}>
                … and {preview.totalLines - MAX_PREVIEW_ROWS} more row{preview.totalLines - MAX_PREVIEW_ROWS !== 1 ? "s" : ""}
              </div>
            )}
          </>
        )}

        {/* ── Phase: done — results ── */}
        {phase === "done" && result && (
          <div>
            {/* Summary counters */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1, background: "#0e1019", borderRadius: 10, padding: "18px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: mono, fontSize: 28, color: "#4ade80", fontWeight: 500 }}>
                  {result.imported}
                </div>
                <div style={{ fontFamily: mono, fontSize: 9, color: "#3a3f5a", letterSpacing: 2, textTransform: "uppercase", marginTop: 6 }}>
                  Imported
                </div>
              </div>
              <div style={{ flex: 1, background: "#0e1019", borderRadius: 10, padding: "18px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: mono, fontSize: 28, color: result.skipped > 0 ? "#f87171" : "#3a3f5a", fontWeight: 500 }}>
                  {result.skipped}
                </div>
                <div style={{ fontFamily: mono, fontSize: 9, color: "#3a3f5a", letterSpacing: 2, textTransform: "uppercase", marginTop: 6 }}>
                  Skipped
                </div>
              </div>
            </div>

            {/* Per-row errors */}
            {result.errors?.length > 0 && (
              <>
                <div style={S.sectionLabel}>Skipped rows</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflowY: "auto" }}>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ background: "#2a1010", border: "1px solid #f8717133", borderRadius: 7, padding: "8px 12px", fontFamily: mono, fontSize: 10, color: "#f87171" }}>
                      <span style={{ color: "#f87171aa" }}>Row {e.row}:</span> {e.message}
                    </div>
                  ))}
                </div>
              </>
            )}

            {result.imported === 0 && result.skipped === 0 && (
              <div style={{ fontFamily: mono, fontSize: 11, color: "#3a3f5a", textAlign: "center", padding: 20 }}>
                The file contained no data rows.
              </div>
            )}
          </div>
        )}

        {/* ── Error banner (shows in idle / preview on API error) ── */}
        {error && <div style={S.errorBox}>⚠ {error}</div>}

        {/* ── Footer actions ── */}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button onClick={onClose} style={S.btn.cancel}>
            {phase === "done" ? "Close" : "Cancel"}
          </button>

          {phase === "preview" && (
            <button onClick={doImport} style={S.btn.primary}>
              Import {preview?.rows.slice(0, MAX_IMPORT_ROWS).length} entr
              {preview?.rows.length !== 1 ? "ies" : "y"}
            </button>
          )}

          {phase === "importing" && (
            <button disabled style={S.btn.disabled}>
              Importing…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
