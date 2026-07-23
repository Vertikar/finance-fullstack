import { useState, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "./api";
import AuthScreen from "./AuthScreen";
import { THEMES, SunIcon, MoonIcon } from "./themes";
import ImportModal from "./ImportModal";
import PayCycle from "./PayCycle";
import Budget from "./Budget";
import UserSettings from "./UserSettings";
import {
  toMonthly, buildCashFlow, sumActualForMonth, parseLocal, totalMonthlyBudgets,
  CATEGORIES, CAT_COLORS, CAT_BUCKETS, BUCKET_META, BUCKET_ORDER,
} from "./utils";

// ── Frequency metadata ────────────────────────────────────────────────────────
const FREQ_META = {
  weekly:      { label: "Weekly",      color: "#60a5fa", mult: 52 / 12  },
  fortnightly: { label: "Fortnightly", color: "#a78bfa", mult: 26 / 12  },
  monthly:     { label: "Monthly",     color: "#c4a24a", mult: 1         },
  quarterly:   { label: "Quarterly",   color: "#fb923c", mult: 1 / 3     },
  biannual:    { label: "Biannual",    color: "#34d399", mult: 1 / 6     },
  yearly:      { label: "Yearly",      color: "#f472b6", mult: 1 / 12    },
};
const FREQUENCIES = Object.keys(FREQ_META);
const FREQ_LABELS  = Object.fromEntries(FREQUENCIES.map(f => [f, FREQ_META[f].label]));

// ── Categories & buckets ───────────────────────────────────────────────────────
// CATEGORIES / CAT_COLORS / CAT_BUCKETS live in ./utils as the offline fallback.
// At runtime the app fetches the authoritative list from GET /api/categories
// (see loadCategories below) which also carries each category's bucket + colour.

// ── Helpers ───────────────────────────────────────────────────────────────────
// toMonthly, buildCashFlow, sumActualForMonth and date helpers live in ./utils
// (single source of truth shared with PayCycle and the unit tests).

const fmt     = n => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Math.abs(n));
const fmtFull = n => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

const EMPTY_FORM = {
  name: "", amount: "", type: "expense",
  frequency: "monthly", category: "Housing",
  nextDue: new Date().toISOString().split("T")[0],
};


/** Trigger a browser file download from a Blob without any network request. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Custom hook: window width ─────────────────────────────────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return width;
}

// ── FreqBadge component ───────────────────────────────────────────────────────
function FreqBadge({ freq }) {
  const meta = FREQ_META[freq] ?? { label: freq, color: "#94a3b8" };
  return (
    <span style={{
      fontFamily: "'DM Mono', monospace",
      fontSize: 9, fontWeight: 600, letterSpacing: 1.5,
      borderRadius: 5, padding: "2px 7px",
      textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0,
      color: meta.color,
      background: meta.color + "1a",
      border: `1px solid ${meta.color}44`,
    }}>
      {meta.label}
    </span>
  );
}

// ── LocalStorage helpers ──────────────────────────────────────────────────────
function getStoredUser() {
  try { return JSON.parse(localStorage.getItem("finance_user")); } catch { return null; }
}

// ── Tab config ────────────────────────────────────────────────────────────────
const TABS = [
  { key: "dashboard", icon: "◎", label: "Overview"  },
  { key: "payments",  icon: "☰", label: "Payments"  },
  { key: "cashflow",  icon: "◈", label: "Cash Flow" },
  { key: "paycycle",  icon: "◑", label: "Pay Cycle" },
  { key: "budget",    icon: "▣", label: "Budget"    },
  { key: "settings",  icon: "⚙", label: "Settings"  },
];

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const screenWidth = useWindowWidth();
  const isMobile = screenWidth < 768;

  // Read theme from localStorage synchronously to avoid flash on mount
  const [themeKey, setThemeKey] = useState(() => {
    try {
      const s = localStorage.getItem("fin_theme");
      return s && THEMES[s] ? s : "dark";
    } catch { return "dark"; }
  });
  const T = THEMES[themeKey];

  const [user,       setUser]       = useState(getStoredUser);
  const [entries,    setEntries]    = useState([]);
  const [budgets,    setBudgets]    = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [tab,        setTab]        = useState("dashboard");
  const [modal,      setModal]      = useState(null);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [filterType, setFilterType] = useState("all");
  const [freqFilter, setFreqFilter] = useState("all");
  const [bucketFilter, setBucketFilter] = useState("all");
  const [apiError,      setApiError]      = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportLoading,   setExportLoading]   = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getEntries();
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e.message.includes("token")) handleLogout();
      setApiError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadBudgets = useCallback(async () => {
    try {
      const data = await api.getBudgets();
      setBudgets(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e.message.includes("token")) handleLogout();
      setApiError(e.message);
    }
  }, []);

  // Categories are global reference data. On failure we silently keep the
  // built-in fallback constants so the UI still renders category pickers/colours.
  const loadCategories = useCallback(async () => {
    try {
      const data = await api.getCategories();
      if (Array.isArray(data)) setCategories(data);
    } catch {
      // fall back to CATEGORIES/CAT_COLORS/CAT_BUCKETS constants
    }
  }, []);

  useEffect(() => {
    if (user) { loadEntries(); loadBudgets(); loadCategories(); }
  }, [user, loadEntries, loadBudgets, loadCategories]);

  function handleLogout() {
    localStorage.removeItem("finance_token");
    localStorage.removeItem("finance_user");
    setUser(null);
    setEntries([]);
    setBudgets([]);
  }

  function toggleTheme() {
    const next = themeKey === "dark" ? "light" : "dark";
    setThemeKey(next);
    try { localStorage.setItem("fin_theme", next); } catch {}
  }

  if (!user) return (
    <AuthScreen
      onAuth={u => setUser(u)}
      themeKey={themeKey}
      T={T}
      toggleTheme={toggleTheme}
    />
  );

  // ── Derived stats ───────────────────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const income   = entries.filter(e => e.type === "income");
  const expenses = entries.filter(e => e.type === "expense");

  // ── Category / bucket lookups (DB-backed, with constant fallback) ────────────
  const catMeta = {};
  categories.forEach(c => { catMeta[c.name] = c; });
  const colorOf  = (name, fb = "#94a3b8") => catMeta[name]?.color  || CAT_COLORS[name]  || fb;
  const bucketOf = (name) => catMeta[name]?.bucket || CAT_BUCKETS[name] || "living";
  const catOptions = categories.length
    ? {
        income:  categories.filter(c => c.type === "income").map(c => c.name),
        expense: categories.filter(c => c.type === "expense").map(c => c.name),
      }
    : CATEGORIES;

  // Variable-expense budgets are flat monthly allowances folded into the
  // monthly-equivalent totals so "leftover" reflects planned variable spending.
  const monthlyBudgets  = totalMonthlyBudgets(budgets);
  const monthlyIncome   = income.reduce((s, e)   => s + toMonthly(e.amount, e.frequency), 0);
  const monthlyExpenses = expenses.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0) + monthlyBudgets;
  const monthlyNet      = monthlyIncome - monthlyExpenses;
  const savingsRate     = monthlyIncome > 0 ? (monthlyNet / monthlyIncome) * 100 : 0;

  // Calendar-accurate totals for the current month — these reflect "heavy"
  // months where a fortnightly/weekly bill actually falls 3/5 times, unlike the
  // averaged monthly-equivalent figures above.
  const { income: actualIncome, expenses: actualExpenses } = sumActualForMonth(entries, today);

  const upcoming = entries
    .map(e => ({ ...e, due: parseLocal(e.nextDue) }))
    .filter(e => { const d = (e.due - today) / 86400000; return d >= 0 && d <= 60; })
    .sort((a, b) => a.due - b.due);

  const catTotals = {};
  expenses.forEach(e => {
    catTotals[e.category] = (catTotals[e.category] || 0) + toMonthly(e.amount, e.frequency);
  });
  budgets.forEach(b => {
    catTotals[b.category] = (catTotals[b.category] || 0) + (Number(b.amount) || 0);
  });
  const catData = Object.entries(catTotals)
    .map(([name, value]) => ({ name, value: Math.round(value), color: colorOf(name) }))
    .sort((a, b) => b.value - a.value);

  // Bucket breakdown: fold each category's monthly-equivalent expense total into
  // its bucket. Income is reported separately (monthlyIncome), so the donut shows
  // only the spending buckets (living / lifestyle / goals).
  const bucketTotals = {};
  Object.entries(catTotals).forEach(([name, value]) => {
    const b = bucketOf(name);
    bucketTotals[b] = (bucketTotals[b] || 0) + value;
  });
  const bucketData = BUCKET_ORDER
    .filter(b => b !== "income")
    .map(b => ({ name: BUCKET_META[b].label, value: Math.round(bucketTotals[b] || 0), color: BUCKET_META[b].color }))
    .filter(d => d.value > 0);

  const rhythmTotals = {};
  expenses.forEach(e => {
    rhythmTotals[e.frequency] = (rhythmTotals[e.frequency] || 0) + toMonthly(e.amount, e.frequency);
  });
  const rhythmData = Object.entries(rhythmTotals).sort((a, b) => b[1] - a[1]);
  const maxRhythm  = rhythmData.length > 0 ? rhythmData[0][1] : 1;

  const cfEvents = buildCashFlow(entries, today, 90);

  const cfWeeks = {};
  cfEvents.forEach(e => {
    const diffDays  = Math.floor((e.dueDate - today) / 86400000);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() + Math.floor(diffDays / 7) * 7);
    const wKey = weekStart.toISOString().split("T")[0];
    if (!cfWeeks[wKey]) cfWeeks[wKey] = [];
    cfWeeks[wKey].push(e);
  });

  const listEntries = entries.filter(e =>
    (filterType   === "all" || e.type      === filterType) &&
    (freqFilter   === "all" || e.frequency === freqFilter) &&
    (bucketFilter === "all" || bucketOf(e.category) === bucketFilter)
  );

  function daysLabel(dateStr) {
    const d = Math.round((parseLocal(dateStr) - today) / 86400000);
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    return `${d}d`;
  }

  function openAdd()   { setForm({ ...EMPTY_FORM, nextDue: new Date().toISOString().split("T")[0] }); setModal("add"); }
  function openEdit(e) { setForm({ ...e }); setModal("edit"); }

  async function saveEntry() {
    if (!form.name.trim() || !form.amount) return;
    const payload = { ...form, amount: parseFloat(form.amount) };
    try {
      if (modal === "add") {
        const created = await api.createEntry(payload);
        setEntries(p => [...p, created]);
      } else {
        const updated = await api.updateEntry(form.id, payload);
        setEntries(p => p.map(e => e.id === updated.id ? updated : e));
      }
      setModal(null);
    } catch (e) { setApiError(e.message); }
  }

  async function deleteEntry(id) {
    try {
      await api.deleteEntry(id);
      setEntries(p => p.filter(e => e.id !== id));
    } catch (e) { setApiError(e.message); }
  }


  // ── Export ──────────────────────────────────────────────────────────────────
  async function handleExport() {
    setExportLoading(true);
    setApiError("");
    try {
      const { blob, filename } = await api.exportEntries();
      downloadBlob(blob, filename);
    } catch (e) {
      setApiError(e.message);
    } finally {
      setExportLoading(false);
    }
  }

  // ── Style tokens ────────────────────────────────────────────────────────────
  const S = {
    card: {
      background: T.bgCard,
      border: `1px solid ${T.border}`,
      borderRadius: 12,
      padding: isMobile ? "14px" : "18px 20px",
    },
    label: {
      fontFamily: "'DM Mono',monospace",
      fontSize: 9, letterSpacing: 2.5,
      color: T.textMuted, textTransform: "uppercase",
      marginBottom: 10, display: "block",
    },
    mono: { fontFamily: "'DM Mono',monospace" },
  };

  const contentPad = isMobile ? { padding: "14px" } : { padding: "24px 28px" };

  // Dynamic CSS — regenerates on theme change
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400;600&family=DM+Mono:wght@300;400;500&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 3px; }
    ::-webkit-scrollbar-thumb { background: ${T.scrollThumb}; border-radius: 2px; }
    input, select {
      background: ${T.bgInner} !important;
      border: 1px solid ${T.border2} !important;
      color: ${T.text} !important;
      border-radius: 8px; padding: 9px 13px;
      font-family: 'DM Mono', monospace; font-size: 13px;
      outline: none; width: 100%; transition: border-color .2s;
    }
    input:focus, select:focus { border-color: ${T.accent} !important; }
    input::placeholder { color: ${T.textMuted}; }
    option { background: ${T.bgCard}; color: ${T.text}; }
    .theme-toggle {
      display: flex; align-items: center; gap: 6px;
      background: ${T.bgSubtle}; border: 1px solid ${T.border2};
      border-radius: 20px; padding: 5px 12px 5px 8px;
      cursor: pointer; transition: background .2s, border-color .2s;
      font-family: 'DM Mono', monospace; font-size: 10px;
      color: ${T.textMid}; letter-spacing: 1px; white-space: nowrap;
    }
    .theme-toggle:hover { border-color: ${T.accent}; color: ${T.accent}; }
  `;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      fontFamily: "'Crimson Pro', Georgia, serif",
      background: T.bg, minHeight: "100vh", color: T.text,
      transition: "background .25s, color .25s",
      ...(isMobile ? { display: "flex", flexDirection: "column" } : {}),
    }}>
      <style>{css}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{
        background: T.bgHeader, borderBottom: `1px solid ${T.border}`,
        padding: isMobile ? "12px 16px" : "16px 28px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexShrink: 0, transition: "background .25s",
        ...(isMobile ? { position: "sticky", top: 0, zIndex: 20 } : {}),
      }}>
        <div>
          <div style={{ ...S.mono, fontSize: 9, letterSpacing: 3.5, color: T.accent, textTransform: "uppercase", marginBottom: 4 }}>
            Personal Finance
          </div>
          <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 300 }}>
            {isMobile ? "Dashboard" : "My Money Dashboard"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 16 }}>
          {!isMobile && (
            <div style={{ ...S.mono, fontSize: 10, color: T.textMuted }}>{user.email}</div>
          )}
          <div style={{ textAlign: "right" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: monthlyNet >= 0 ? T.income : T.expense }} />
              <span style={{ ...S.mono, fontSize: isMobile ? 13 : 11, fontWeight: 500, color: monthlyNet >= 0 ? T.income : T.expense }}>
                {monthlyNet >= 0 ? "+" : "–"}{fmt(monthlyNet)}
                <span style={{ fontSize: 9, color: T.textMuted }}>/mo</span>
              </span>
            </div>
            {isMobile && (
              <div style={{ ...S.mono, fontSize: 9, color: T.textMuted, marginTop: 2 }}>
                {savingsRate.toFixed(1)}% saved
              </div>
            )}
          </div>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={themeKey === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {themeKey === "dark" ? <SunIcon color={T.textMid} /> : <MoonIcon color={T.textMid} />}
            {!isMobile && (themeKey === "dark" ? "Light" : "Dark")}
          </button>
          <button
            onClick={handleLogout}
            style={{
              background: T.bgSubtle, border: `1px solid ${T.border2}`, color: T.textMuted,
              borderRadius: 8, padding: isMobile ? "7px 10px" : "7px 14px",
              cursor: "pointer", ...S.mono, fontSize: 10,
            }}
          >
            {isMobile ? "↩" : "Sign Out"}
          </button>
        </div>
      </div>

      {/* ── DESKTOP TAB BAR ────────────────────────────────────────────────── */}
      {!isMobile && (
        <div style={{ display: "flex", background: T.bgHeader, borderBottom: `1px solid ${T.border}`, padding: "0 20px", flexShrink: 0 }}>
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)} style={{
              background: "none", border: "none",
              color: tab === key ? T.accent : T.textMuted,
              padding: "14px 18px", cursor: "pointer",
              ...S.mono, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase",
              borderBottom: tab === key ? `2px solid ${T.accent}` : "2px solid transparent",
              transition: "color .15s",
            }}>{label}</button>
          ))}
        </div>
      )}

      {/* ── ERROR BANNER ───────────────────────────────────────────────────── */}
      {apiError && (
        <div style={{
          background: T.errorBg, borderBottom: `1px solid ${T.errorBorder}`,
          padding: "10px 28px", display: "flex", justifyContent: "space-between",
          ...S.mono, fontSize: 11, color: T.expense, flexShrink: 0,
        }}>
          <span>⚠ {apiError}</span>
          <button onClick={() => setApiError("")} style={{ background: "none", border: "none", color: T.expense, cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* ── LOADING ────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60, ...S.mono, fontSize: 11, color: T.textMuted, letterSpacing: 2 }}>
          Loading…
        </div>
      )}

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
      {!loading && (
        <div style={{
          ...contentPad,
          ...(isMobile ? { flex: 1 } : {}),
        }}>
          <div style={{ maxWidth: 960, margin: "0 auto" }}>

            {/* ── DASHBOARD ─────────────────────────────────────────────── */}
            {tab === "dashboard" && (
              <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 20 }}>

                {/* Stats grid */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap: isMobile ? 10 : 14 }}>
                  {[
                    { label: "Monthly Income",   val: fmt(monthlyIncome),                               sub: `${fmt(actualIncome)} this month`,         color: T.income  },
                    { label: "Monthly Expenses", val: fmt(monthlyExpenses),                             sub: `${fmt(actualExpenses + monthlyBudgets)} this month`, color: T.expense },
                    { label: "Monthly Net",      val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet), sub: `${savingsRate.toFixed(1)}% savings rate`, color: monthlyNet >= 0 ? T.income : T.expense },
                    { label: "Annual Net",       val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet * 12), sub: `${entries.length} recurring entries`, color: T.accent  },
                  ].map(c => (
                    <div key={c.label} style={S.card}>
                      <span style={S.label}>{c.label}</span>
                      <div style={{ ...S.mono, fontSize: isMobile ? 15 : 20, fontWeight: 500, color: c.color, marginBottom: 4 }}>{c.val}</div>
                      <div style={{ ...S.mono, fontSize: 9, color: T.textVeryMuted }}>{c.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Savings rate bar */}
                <div style={S.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={S.label}>Savings Rate</span>
                    <div style={{ ...S.mono, fontSize: 12, color: savingsRate >= 20 ? T.income : savingsRate >= 10 ? T.warn : T.expense }}>
                      {savingsRate.toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ background: T.bgSubtle, borderRadius: 6, height: 8, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, savingsRate))}%`, background: savingsRate >= 20 ? T.income : savingsRate >= 10 ? T.warn : T.expense, borderRadius: 6, transition: "width .5s ease" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, ...S.mono, fontSize: 9, color: T.textMuted }}>
                    <span>0%</span><span style={{ color: T.warn }}>10% good</span>
                    <span style={{ color: T.income }}>20% great</span><span>100%</span>
                  </div>
                </div>

                {/* Expenses by Payment Rhythm */}
                <div style={S.card}>
                  <span style={{ ...S.label, color: T.accent }}>Expenses by Payment Rhythm</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {rhythmData.map(([freq, monthly]) => {
                      const meta = FREQ_META[freq] ?? { label: freq, color: "#94a3b8" };
                      const pct  = maxRhythm > 0 ? (monthly / maxRhythm) * 100 : 0;
                      return (
                        <div key={freq}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <FreqBadge freq={freq} />
                              <span style={{ ...S.mono, fontSize: 10, color: T.textMid }}>{meta.label} payments</span>
                            </div>
                            <span style={{ ...S.mono, fontSize: 11, color: T.text }}>
                              {fmt(monthly)}<span style={{ color: T.textMuted }}>/mo equiv</span>
                            </span>
                          </div>
                          <div style={{ background: T.bgSubtle, borderRadius: 3, height: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: meta.color + "88", borderRadius: 3 }} />
                          </div>
                        </div>
                      );
                    })}
                    {rhythmData.length === 0 && (
                      <div style={{ color: T.textMuted, fontSize: 13, textAlign: "center", padding: 12 }}>No expenses yet</div>
                    )}
                  </div>
                </div>

                {/* Upcoming + Pie */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 12 : 16 }}>

                  <div style={S.card}>
                    <span style={{ ...S.label, color: T.accent }}>Upcoming · 60 days</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {upcoming.slice(0, isMobile ? 6 : 9).map((e, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: T.bgInner, borderRadius: 8, borderLeft: `3px solid ${colorOf(e.category, "#4a4f6a")}` }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14 }}>{e.name}</span>
                              <FreqBadge freq={e.frequency} />
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span style={{ ...S.mono, fontSize: 9, color: T.textMuted }}>{e.nextDue}</span>
                              <span style={{ ...S.mono, fontSize: 9, background: T.bgSubtle, padding: "1px 5px", borderRadius: 4, color: T.textMid }}>{daysLabel(e.nextDue)}</span>
                            </div>
                          </div>
                          <div style={{ ...S.mono, fontSize: 13, color: e.type === "income" ? T.income : T.expense, marginLeft: 12, flexShrink: 0 }}>
                            {e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}
                          </div>
                        </div>
                      ))}
                      {upcoming.length === 0 && (
                        <div style={{ color: T.textMuted, fontSize: 13, padding: 20, textAlign: "center" }}>No upcoming payments</div>
                      )}
                    </div>
                  </div>

                  <div style={S.card}>
                    <span style={{ ...S.label, color: T.accent }}>Expense Breakdown / Month</span>
                    <ResponsiveContainer width="100%" height={isMobile ? 140 : 160}>
                      <PieChart>
                        <Pie data={catData} cx="50%" cy="50%" innerRadius={isMobile ? 38 : 44} outerRadius={isMobile ? 60 : 68} dataKey="value" paddingAngle={2} strokeWidth={0}>
                          {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip formatter={v => [fmt(v), "Monthly"]} contentStyle={{ background: T.tooltipBg, border: `1px solid ${T.tooltipBorder}`, borderRadius: 8, ...S.mono, fontSize: 11, color: T.text }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {catData.slice(0, isMobile ? 4 : 6).map(c => (
                        <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
                            <span style={{ ...S.mono, fontSize: 10, color: T.textMid }}>{c.name}</span>
                          </div>
                          <span style={{ ...S.mono, fontSize: 10, color: T.text }}>{fmt(c.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>

                {/* Spending by Bucket */}
                <div style={S.card}>
                  <span style={{ ...S.label, color: T.accent }}>Spending by Bucket / Month</span>
                  {bucketData.length === 0 ? (
                    <div style={{ color: T.textMuted, fontSize: 13, textAlign: "center", padding: 12 }}>No expenses yet</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "160px 1fr", gap: isMobile ? 8 : 20, alignItems: "center" }}>
                      <ResponsiveContainer width="100%" height={isMobile ? 130 : 150}>
                        <PieChart>
                          <Pie data={bucketData} cx="50%" cy="50%" innerRadius={isMobile ? 36 : 42} outerRadius={isMobile ? 58 : 66} dataKey="value" paddingAngle={2} strokeWidth={0}>
                            {bucketData.map((e, i) => <Cell key={i} fill={e.color} />)}
                          </Pie>
                          <Tooltip formatter={v => [fmt(v), "Monthly"]} contentStyle={{ background: T.tooltipBg, border: `1px solid ${T.tooltipBorder}`, borderRadius: 8, ...S.mono, fontSize: 11, color: T.text }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {bucketData.map(b => {
                          const pct = monthlyExpenses > 0 ? (b.value / monthlyExpenses) * 100 : 0;
                          return (
                            <div key={b.name}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ width: 8, height: 8, borderRadius: 2, background: b.color }} />
                                  <span style={{ ...S.mono, fontSize: 10, color: T.textMid }}>{b.name}</span>
                                </div>
                                <span style={{ ...S.mono, fontSize: 10, color: T.text }}>{fmt(b.value)}<span style={{ color: T.textMuted }}> · {pct.toFixed(0)}%</span></span>
                              </div>
                              <div style={{ background: T.bgSubtle, borderRadius: 3, height: 4, overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${pct}%`, background: b.color + "88", borderRadius: 3 }} />
                              </div>
                            </div>
                          );
                        })}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2, paddingTop: 8, borderTop: `1px solid ${T.border2}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: BUCKET_META.income.color }} />
                            <span style={{ ...S.mono, fontSize: 10, color: T.textMid }}>{BUCKET_META.income.label}</span>
                          </div>
                          <span style={{ ...S.mono, fontSize: 10, color: T.income }}>{fmt(monthlyIncome)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── PAYMENTS ──────────────────────────────────────────────── */}
            {tab === "payments" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[["all","All"],["income","Income"],["expense","Expenses"]].map(([v,l]) => (
                      <button key={v} onClick={() => setFilterType(v)} style={{
                        background: filterType === v ? T.accent : T.bgCard,
                        color: filterType === v ? T.accentText : T.textMuted,
                        border: `1px solid ${filterType === v ? T.accent : T.border}`,
                        borderRadius: 8, padding: "7px 14px", cursor: "pointer",
                        ...S.mono, fontSize: 11, letterSpacing: 1,
                      }}>{l}</button>
                    ))}
                  </div>
                  {/* Export / Import / Add */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {entries.length > 0 && (
                      <button onClick={handleExport} disabled={exportLoading} title="Download all entries as a CSV file"
                        style={{ background: T.bgCard, color: exportLoading ? T.textMuted : T.textMid, border: `1px solid ${T.border}`, borderRadius: 8, padding: isMobile ? "7px 10px" : "7px 14px", cursor: exportLoading ? "wait" : "pointer", ...S.mono, fontSize: 11, letterSpacing: 1 }}>
                        {exportLoading ? "…" : (isMobile ? "↓" : "↓ Export")}
                      </button>
                    )}
                    <button onClick={() => setShowImportModal(true)} title="Import entries from a CSV file"
                      style={{ background: T.bgCard, color: T.textMid, border: `1px solid ${T.border}`, borderRadius: 8, padding: isMobile ? "7px 10px" : "7px 14px", cursor: "pointer", ...S.mono, fontSize: 11, letterSpacing: 1 }}>
                      {isMobile ? "↑" : "↑ Import"}
                    </button>
                    <button onClick={openAdd} style={{ background: T.accent, color: T.accentText, border: "none", borderRadius: 9, padding: "9px 18px", ...S.mono, fontSize: 11, cursor: "pointer", letterSpacing: 1, fontWeight: 700 }}>
                      + Add
                    </button>
                  </div>
                </div>

                {/* Rhythm filter */}
                <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ ...S.mono, fontSize: 9, color: T.textMuted, letterSpacing: 1.5, textTransform: "uppercase" }}>Rhythm:</span>
                  <button onClick={() => setFreqFilter("all")} style={{
                    borderRadius: 5, padding: "3px 10px", ...S.mono, fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                    cursor: "pointer", border: `1px solid ${T.border2}`,
                    background: freqFilter === "all" ? T.bgSubtle : "transparent",
                    color: freqFilter === "all" ? T.text : T.textMuted,
                  }}>All</button>
                  {FREQUENCIES.map(f => {
                    const active = freqFilter === f;
                    const meta   = FREQ_META[f];
                    return (
                      <button key={f} onClick={() => setFreqFilter(f)} style={{
                        borderRadius: 5, padding: "3px 10px", ...S.mono, fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                        cursor: "pointer", border: "1px solid",
                        background:  active ? meta.color + "22" : "transparent",
                        color:       active ? meta.color         : T.textMuted,
                        borderColor: active ? meta.color + "55" : T.border2,
                      }}>{meta.label}</button>
                    );
                  })}
                </div>

                {/* Bucket filter */}
                <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ ...S.mono, fontSize: 9, color: T.textMuted, letterSpacing: 1.5, textTransform: "uppercase" }}>Bucket:</span>
                  <button onClick={() => setBucketFilter("all")} style={{
                    borderRadius: 5, padding: "3px 10px", ...S.mono, fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                    cursor: "pointer", border: `1px solid ${T.border2}`,
                    background: bucketFilter === "all" ? T.bgSubtle : "transparent",
                    color: bucketFilter === "all" ? T.text : T.textMuted,
                  }}>All</button>
                  {BUCKET_ORDER.map(b => {
                    const active = bucketFilter === b;
                    const meta   = BUCKET_META[b];
                    return (
                      <button key={b} onClick={() => setBucketFilter(b)} style={{
                        borderRadius: 5, padding: "3px 10px", ...S.mono, fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                        cursor: "pointer", border: "1px solid",
                        background:  active ? meta.color + "22" : "transparent",
                        color:       active ? meta.color         : T.textMuted,
                        borderColor: active ? meta.color + "55" : T.border2,
                      }}>{meta.label}</button>
                    );
                  })}
                </div>

                {/* Entry list */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {listEntries.length === 0 && (
                    <div style={{ color: T.textMuted, textAlign: "center", padding: 40 }}>No entries match current filters</div>
                  )}
                  {listEntries.map(e => (
                    <div key={e.id} style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ width: 4, height: 44, borderRadius: 3, background: colorOf(e.category, "#4a4f6a"), flexShrink: 0, marginTop: 2 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 15, color: T.text }}>{e.name}</span>
                            <FreqBadge freq={e.frequency} />
                          </div>
                          <div style={{ ...S.mono, fontSize: 11, marginBottom: 3 }}>
                            <span style={{ color: e.type === "income" ? T.income : T.expense }}>{e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}</span>
                            <span style={{ color: T.textMuted }}> · {fmt(toMonthly(e.amount, e.frequency))}/mo equiv</span>
                          </div>
                          <div style={{ ...S.mono, fontSize: 9, color: T.textMuted }}>{e.category} · Next {e.nextDue}</div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button onClick={() => openEdit(e)} style={{ background: T.bgSubtle, border: `1px solid ${T.border2}`, color: T.accent, borderRadius: 7, padding: "6px 10px", cursor: "pointer", ...S.mono, fontSize: 10 }}>Edit</button>
                          <button onClick={() => deleteEntry(e.id)} style={{ background: T.bgSubtle, border: `1px solid ${T.border2}`, color: T.expense, borderRadius: 7, padding: "6px 10px", cursor: "pointer", ...S.mono, fontSize: 10 }}>×</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary footer */}
                <div style={{ marginTop: 20, background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, padding: "14px 20px", display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 12 }}>
                  {[
                    { label: "Total Income",   val: fmt(monthlyIncome)   + "/mo", color: T.income  },
                    { label: "Total Expenses", val: fmt(monthlyExpenses) + "/mo", color: T.expense },
                    { label: "Net Position",   val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet) + "/mo", color: monthlyNet >= 0 ? T.income : T.expense },
                  ].map(c => (
                    <div key={c.label} style={{ textAlign: "center" }}>
                      <div style={{ ...S.mono, fontSize: 9, color: T.textMuted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>{c.label}</div>
                      <div style={{ ...S.mono, fontSize: isMobile ? 13 : 15, color: c.color }}>{c.val}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── CASH FLOW ─────────────────────────────────────────────── */}
            {tab === "cashflow" && (
              <div>
                <div style={{ ...S.mono, fontSize: 9, letterSpacing: 2.5, color: T.accent, textTransform: "uppercase", marginBottom: isMobile ? 14 : 20 }}>
                  Cash Flow · Next 90 Days
                </div>
                {Object.entries(cfWeeks).map(([weekStart, evts], wi) => {
                  const wDate     = new Date(weekStart);
                  const wIncome   = evts.filter(e => e.type === "income").reduce((s, e) => s + e.amount, 0);
                  const wExpenses = evts.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0);
                  const wNet      = wIncome - wExpenses;
                  const weekLabel = wi === 0
                    ? "This Week"
                    : wDate.toLocaleDateString("en-AU", { weekday: isMobile ? "short" : "long", month: "short", day: "numeric" });
                  return (
                    <div key={weekStart} style={{ ...S.card, marginBottom: 14, borderRadius: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                        <div style={{ ...S.mono, fontSize: isMobile ? 11 : 12, color: T.text }}>{weekLabel}</div>
                        <div style={{ display: "flex", gap: 12 }}>
                          {wIncome   > 0 && <span style={{ ...S.mono, fontSize: 10, color: T.income }}>+{fmt(wIncome)}</span>}
                          {wExpenses > 0 && <span style={{ ...S.mono, fontSize: 10, color: T.expense }}>–{fmt(wExpenses)}</span>}
                          <span style={{ ...S.mono, fontSize: 10, color: wNet >= 0 ? T.income : T.expense, borderLeft: `1px solid ${T.border2}`, paddingLeft: 12 }}>
                            {wNet >= 0 ? "+" : "–"}{fmt(wNet)} net
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {evts.map((e, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: T.bgInner, borderRadius: 7, flexWrap: isMobile ? "wrap" : "nowrap", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
                              <div style={{ width: 7, height: 7, borderRadius: "50%", background: colorOf(e.category, "#4a4f6a"), flexShrink: 0 }} />
                              <span style={{ fontSize: 14, color: T.text }}>{e.name}</span>
                              <FreqBadge freq={e.frequency} />
                              <span style={{ ...S.mono, fontSize: 9, color: T.textMuted }}>{e.dueStr}</span>
                            </div>
                            <span style={{ ...S.mono, fontSize: 13, color: e.type === "income" ? T.income : T.expense, flexShrink: 0 }}>
                              {e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {cfEvents.length === 0 && (
                  <div style={{ color: T.textMuted, textAlign: "center", padding: 40 }}>No upcoming cash flows</div>
                )}
              </div>
            )}

            {/* ── PAY CYCLE ─────────────────────────────────────────────── */}
            {tab === "paycycle" && (
              <PayCycle entries={entries} T={T} isMobile={isMobile} />
            )}

            {tab === "budget" && (
              <Budget
                entries={entries}
                budgets={budgets}
                setBudgets={setBudgets}
                T={T}
                isMobile={isMobile}
                setApiError={setApiError}
              />
            )}

            {tab === "settings" && (
              <UserSettings T={T} isMobile={isMobile} />
            )}

          </div>
        </div>
      )}

      {/* ── MOBILE BOTTOM NAV ──────────────────────────────────────────────── */}
      {isMobile && (
        <div style={{
          flexShrink: 0, background: T.bgHeader, borderTop: `1px solid ${T.border}`, display: "flex",
          transition: "background .25s",
          position: "sticky", bottom: 0, zIndex: 20,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}>
          {TABS.map(({ key, icon, label }) => (
            <button key={key} onClick={() => setTab(key)} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              background: "none", border: "none", padding: "10px 8px", cursor: "pointer",
              ...S.mono, fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
              color: tab === key ? T.accent : T.textMuted, transition: "color .15s",
            }}>
              <span style={{ fontSize: 17, lineHeight: 1 }}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── ADD / EDIT MODAL ───────────────────────────────────────────────── */}
      {modal && (
        <div
          style={{ position: "fixed", inset: 0, background: T.modalOverlay, display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 200, padding: isMobile ? 0 : 24 }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div style={{
            background: T.bgCard, border: `1px solid ${T.border2}`,
            borderRadius: isMobile ? "16px 16px 0 0" : 16,
            padding: "24px 22px", width: "100%", maxWidth: isMobile ? "100%" : 460,
            transition: "background .25s",
            ...(isMobile ? { maxHeight: "92dvh", overflowY: "auto" } : {}),
          }}>
            <div style={{ ...S.mono, fontSize: 9, letterSpacing: 3, color: T.accent, textTransform: "uppercase", marginBottom: 20 }}>
              {modal === "add" ? "Add New Entry" : "Edit Entry"}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <span style={S.label}>Name</span>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Netflix, Rent, Salary…" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <span style={S.label}>Type</span>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, category: e.target.value === "income" ? "Salary" : "Housing" }))}>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div>
                  <span style={S.label}>Amount ($)</span>
                  <input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <span style={S.label}>Frequency</span>
                  <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                    {FREQUENCIES.map(f => <option key={f} value={f}>{FREQ_LABELS[f]}</option>)}
                  </select>
                </div>
                <div>
                  <span style={S.label}>Category</span>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {(catOptions[form.type] || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <span style={S.label}>Next Due Date</span>
                <input type="date" value={form.nextDue} onChange={e => setForm(f => ({ ...f, nextDue: e.target.value }))} />
              </div>
              {form.amount && (
                <div style={{ background: T.bgInner, borderRadius: 9, padding: "12px 14px", ...S.mono, fontSize: 11, color: T.textMuted, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <FreqBadge freq={form.frequency} />
                  <span style={{ color: T.text }}>{fmtFull(parseFloat(form.amount) || 0)}</span>
                  <span>= <span style={{ color: form.type === "income" ? T.income : T.expense }}>{fmt(toMonthly(parseFloat(form.amount) || 0, form.frequency))}/mo</span></span>
                  <span>· <span style={{ color: T.accent }}>{fmt(toMonthly(parseFloat(form.amount) || 0, form.frequency) * 12)}/yr</span></span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setModal(null)} style={{ flex: 1, background: T.bgSubtle, border: `1px solid ${T.border2}`, color: T.textMid, borderRadius: 9, padding: "12px", ...S.mono, fontSize: 11, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveEntry} style={{ flex: 2, background: T.accent, border: "none", color: T.accentText, borderRadius: 9, padding: "12px", ...S.mono, fontSize: 11, cursor: "pointer", fontWeight: 700, letterSpacing: 1 }}>Save Entry</button>
            </div>
          </div>
        </div>
      )}
      {/* ── IMPORT MODAL ───────────────────────────────────────────────────── */}
      {showImportModal && (
        <ImportModal
          T={T}
          themeKey={themeKey}
          onClose={() => setShowImportModal(false)}
          onImported={loadEntries}
        />
      )}
    </div>
  );
}
