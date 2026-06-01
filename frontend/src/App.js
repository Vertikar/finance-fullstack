import { useState, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "./api";
import AuthScreen from "./AuthScreen";

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

// ── Categories ────────────────────────────────────────────────────────────────
const CATEGORIES = {
  income:  ["Salary", "Freelance", "Investment", "Rental", "Government", "Other Income"],
  expense: [
    "Housing", "Transport", "Food & Groceries", "Utilities", "Insurance",
    "Health", "Entertainment", "Subscriptions", "Education", "Savings",
    "Clothing", "Other",
  ],
};
const CAT_COLORS = {
  Salary: "#4ade80", Freelance: "#34d399", Investment: "#6ee7b7",
  Rental: "#a7f3d0", Government: "#86efac", "Other Income": "#d1fae5",
  Housing: "#f87171", Transport: "#fb923c", "Food & Groceries": "#fbbf24",
  Utilities: "#a78bfa", Insurance: "#60a5fa", Health: "#f472b6",
  Entertainment: "#c084fc", Subscriptions: "#22d3ee", Education: "#818cf8",
  Savings: "#4ade80", Clothing: "#f9a8d4", Other: "#94a3b8",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function toMonthly(amount, freq) {
  return amount * (FREQ_META[freq]?.mult ?? 1);
}

function addFreq(date, freq) {
  const d = new Date(date);
  switch (freq) {
    case "weekly":      d.setDate(d.getDate() + 7);         break;
    case "fortnightly": d.setDate(d.getDate() + 14);        break;
    case "monthly":     d.setMonth(d.getMonth() + 1);       break;
    case "quarterly":   d.setMonth(d.getMonth() + 3);       break;
    case "biannual":    d.setMonth(d.getMonth() + 6);       break;
    case "yearly":      d.setFullYear(d.getFullYear() + 1); break;
    default: break;
  }
  return d;
}

const fmt     = n => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Math.abs(n));
const fmtFull = n => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

const EMPTY_FORM = {
  name: "", amount: "", type: "expense",
  frequency: "monthly", category: "Housing",
  nextDue: new Date().toISOString().split("T")[0],
};

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
      fontSize: 9,
      fontWeight: 600,
      letterSpacing: 1.5,
      borderRadius: 5,
      padding: "2px 7px",
      textTransform: "uppercase",
      whiteSpace: "nowrap",
      flexShrink: 0,
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
];

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const screenWidth = useWindowWidth();
  const isMobile = screenWidth < 768;

  const [user,        setUser]        = useState(getStoredUser);
  const [entries,     setEntries]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [tab,         setTab]         = useState("dashboard");
  const [modal,       setModal]       = useState(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [filterType,  setFilterType]  = useState("all");
  const [freqFilter,  setFreqFilter]  = useState("all");
  const [apiError,    setApiError]    = useState("");

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (user) loadEntries(); }, [user, loadEntries]);

  function handleLogout() {
    localStorage.removeItem("finance_token");
    localStorage.removeItem("finance_user");
    setUser(null);
    setEntries([]);
  }

  if (!user) return <AuthScreen onAuth={u => setUser(u)} />;

  // ── Derived stats ───────────────────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const income   = entries.filter(e => e.type === "income");
  const expenses = entries.filter(e => e.type === "expense");

  const monthlyIncome   = income.reduce((s, e)   => s + toMonthly(e.amount, e.frequency), 0);
  const monthlyExpenses = expenses.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const monthlyNet      = monthlyIncome - monthlyExpenses;
  const savingsRate     = monthlyIncome > 0 ? (monthlyNet / monthlyIncome) * 100 : 0;

  // Upcoming payments — next 60 days
  const upcoming = entries
    .map(e => ({ ...e, due: new Date(e.nextDue) }))
    .filter(e => { const d = (e.due - today) / 86400000; return d >= 0 && d <= 60; })
    .sort((a, b) => a.due - b.due);

  // Pie chart data
  const catTotals = {};
  expenses.forEach(e => {
    catTotals[e.category] = (catTotals[e.category] || 0) + toMonthly(e.amount, e.frequency);
  });
  const catData = Object.entries(catTotals)
    .map(([name, value]) => ({ name, value: Math.round(value), color: CAT_COLORS[name] || "#94a3b8" }))
    .sort((a, b) => b.value - a.value);

  // Rhythm totals — monthly equivalent grouped by frequency
  const rhythmTotals = {};
  expenses.forEach(e => {
    rhythmTotals[e.frequency] = (rhythmTotals[e.frequency] || 0) + toMonthly(e.amount, e.frequency);
  });
  const rhythmData = Object.entries(rhythmTotals).sort((a, b) => b[1] - a[1]);
  const maxRhythm  = rhythmData.length > 0 ? rhythmData[0][1] : 1;

  // Cash flow events — next 90 days
  const cfEnd = new Date(today);
  cfEnd.setDate(cfEnd.getDate() + 90);

  const cfEvents = [];
  entries.forEach(e => {
    let d = new Date(e.nextDue);
    while (d < today) d = addFreq(d, e.frequency);
    while (d <= cfEnd) {
      cfEvents.push({ ...e, dueDate: new Date(d), dueStr: d.toISOString().split("T")[0] });
      d = addFreq(d, e.frequency);
    }
  });
  cfEvents.sort((a, b) => a.dueDate - b.dueDate);

  // Group cash flow by ISO week (Monday-aligned from today)
  const cfWeeks = {};
  cfEvents.forEach(e => {
    const diffDays = Math.floor((e.dueDate - today) / 86400000);
    const weekIdx  = Math.floor(diffDays / 7);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() + weekIdx * 7);
    const wKey = weekStart.toISOString().split("T")[0];
    if (!cfWeeks[wKey]) cfWeeks[wKey] = [];
    cfWeeks[wKey].push(e);
  });

  // Filtered entry list
  const listEntries = entries.filter(e =>
    (filterType === "all" || e.type     === filterType) &&
    (freqFilter  === "all" || e.frequency === freqFilter)
  );

  // ── Utility renderers ───────────────────────────────────────────────────────
  function daysLabel(dateStr) {
    const d = Math.round((new Date(dateStr) - today) / 86400000);
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

  // ── Style tokens ────────────────────────────────────────────────────────────
  const S = {
    card:  {
      background: "#12141e",
      border: "1px solid #191d2e",
      borderRadius: 12,
      padding: isMobile ? "14px" : "18px 20px",
    },
    label: {
      fontFamily: "'DM Mono',monospace",
      fontSize: 9,
      letterSpacing: 2.5,
      color: "#3a3f5a",
      textTransform: "uppercase",
      marginBottom: 10,
      display: "block",
    },
    mono: { fontFamily: "'DM Mono',monospace" },
  };

  const contentPad = isMobile
    ? { padding: "14px 14px" }
    : { padding: "24px 28px" };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      fontFamily: "'Crimson Pro', Georgia, serif",
      background: "#0b0d14",
      minHeight: "100vh",
      color: "#ddd8cc",
      // Flex column on mobile so bottom nav sticks to viewport bottom
      ...(isMobile ? { display: "flex", flexDirection: "column", height: "100dvh" } : {}),
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400;600&family=DM+Mono:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #222536; }
        input, select {
          background: #0e101980 !important;
          border: 1px solid #252840 !important;
          color: #ddd8cc !important;
          border-radius: 8px;
          padding: 9px 13px;
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          outline: none;
          width: 100%;
          transition: border-color .2s;
        }
        input:focus, select:focus { border-color: #c4a24a !important; }
        input::placeholder { color: #3a3f5a; }
        option { background: #141722; }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div style={{
        background: "#0f1119",
        borderBottom: "1px solid #191d2e",
        padding: isMobile ? "12px 16px" : "16px 28px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ ...S.mono, fontSize: 9, letterSpacing: 3.5, color: "#c4a24a", textTransform: "uppercase", marginBottom: 4 }}>
            Personal Finance
          </div>
          <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 300 }}>
            {isMobile ? "Dashboard" : "My Money Dashboard"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 20 }}>
          {!isMobile && (
            <div style={{ ...S.mono, fontSize: 10, color: "#3a3f5a" }}>{user.email}</div>
          )}
          <div style={{ textAlign: "right" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: monthlyNet >= 0 ? "#4ade80" : "#f87171" }} />
              <span style={{ ...S.mono, fontSize: isMobile ? 13 : 11, fontWeight: 500, color: monthlyNet >= 0 ? "#4ade80" : "#f87171" }}>
                {monthlyNet >= 0 ? "+" : "–"}{fmt(monthlyNet)}
                <span style={{ fontSize: 9, color: "#3a3f5a" }}>/mo</span>
              </span>
            </div>
            {isMobile && (
              <div style={{ ...S.mono, fontSize: 9, color: "#3a3f5a", marginTop: 2 }}>
                {savingsRate.toFixed(1)}% saved
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: "#191d2e", border: "1px solid #252840", color: "#3a3f5a",
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
        <div style={{ display: "flex", background: "#0f1119", borderBottom: "1px solid #191d2e", padding: "0 20px", flexShrink: 0 }}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                background: "none", border: "none",
                color: tab === key ? "#c4a24a" : "#3a3f5a",
                padding: "14px 18px", cursor: "pointer",
                ...S.mono, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase",
                borderBottom: tab === key ? "2px solid #c4a24a" : "2px solid transparent",
                transition: "color .15s",
              }}
            >{label}</button>
          ))}
        </div>
      )}

      {/* ── ERROR BANNER ───────────────────────────────────────────────────── */}
      {apiError && (
        <div style={{
          background: "#2a1010", borderBottom: "1px solid #f8717133",
          padding: "10px 28px", display: "flex", justifyContent: "space-between",
          ...S.mono, fontSize: 11, color: "#f87171", flexShrink: 0,
        }}>
          <span>⚠ {apiError}</span>
          <button onClick={() => setApiError("")} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* ── LOADING ────────────────────────────────────────────────────────── */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60, ...S.mono, fontSize: 11, color: "#3a3f5a", letterSpacing: 2 }}>
          Loading…
        </div>
      )}

      {/* ── MAIN CONTENT ───────────────────────────────────────────────────── */}
      {!loading && (
        <div style={{
          ...contentPad,
          ...(isMobile ? { flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } : {}),
        }}>
          <div style={{ maxWidth: 960, margin: "0 auto" }}>

            {/* ─────────────────── DASHBOARD TAB ─────────────────────────── */}
            {tab === "dashboard" && (
              <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 12 : 20 }}>

                {/* Stats grid — 2×2 on mobile, 4×1 on desktop */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)",
                  gap: isMobile ? 10 : 14,
                }}>
                  {[
                    { label: "Monthly Income",   val: fmt(monthlyIncome),                                sub: `${fmt(monthlyIncome * 12)}/yr`,              color: "#4ade80" },
                    { label: "Monthly Expenses", val: fmt(monthlyExpenses),                              sub: `${fmt(monthlyExpenses * 12)}/yr`,            color: "#f87171" },
                    { label: "Monthly Net",      val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet),  sub: `${savingsRate.toFixed(1)}% savings rate`,     color: monthlyNet >= 0 ? "#4ade80" : "#f87171" },
                    { label: "Annual Net",       val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet * 12), sub: `${entries.length} recurring entries`,    color: "#c4a24a" },
                  ].map(c => (
                    <div key={c.label} style={S.card}>
                      <span style={S.label}>{c.label}</span>
                      <div style={{ ...S.mono, fontSize: isMobile ? 15 : 20, fontWeight: 500, color: c.color, marginBottom: 4 }}>{c.val}</div>
                      <div style={{ ...S.mono, fontSize: 9, color: "#2e3350" }}>{c.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Savings rate bar */}
                <div style={S.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={S.label}>Savings Rate</span>
                    <div style={{ ...S.mono, fontSize: 12, color: savingsRate >= 20 ? "#4ade80" : savingsRate >= 10 ? "#fbbf24" : "#f87171" }}>
                      {savingsRate.toFixed(1)}%
                    </div>
                  </div>
                  <div style={{ background: "#191d2e", borderRadius: 6, height: 8, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(100, Math.max(0, savingsRate))}%`,
                      background: savingsRate >= 20 ? "#4ade80" : savingsRate >= 10 ? "#fbbf24" : "#f87171",
                      borderRadius: 6, transition: "width .5s ease",
                    }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, ...S.mono, fontSize: 9, color: "#3a3f5a" }}>
                    <span>0%</span>
                    <span style={{ color: "#fbbf24" }}>10% good</span>
                    <span style={{ color: "#4ade80" }}>20% great</span>
                    <span>100%</span>
                  </div>
                </div>

                {/* Expenses by Payment Rhythm — new section */}
                <div style={S.card}>
                  <span style={{ ...S.label, color: "#c4a24a" }}>Expenses by Payment Rhythm</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {rhythmData.map(([freq, monthly]) => {
                      const meta = FREQ_META[freq] ?? { label: freq, color: "#94a3b8" };
                      const pct  = maxRhythm > 0 ? (monthly / maxRhythm) * 100 : 0;
                      return (
                        <div key={freq}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <FreqBadge freq={freq} />
                              <span style={{ ...S.mono, fontSize: 10, color: "#7a8299" }}>
                                {meta.label} payments
                              </span>
                            </div>
                            <span style={{ ...S.mono, fontSize: 11 }}>
                              {fmt(monthly)}<span style={{ color: "#3a3f5a" }}>/mo equiv</span>
                            </span>
                          </div>
                          <div style={{ background: "#191d2e", borderRadius: 3, height: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: meta.color + "88", borderRadius: 3 }} />
                          </div>
                        </div>
                      );
                    })}
                    {rhythmData.length === 0 && (
                      <div style={{ color: "#3a3f5a", fontSize: 13, textAlign: "center", padding: 12 }}>No expenses yet</div>
                    )}
                  </div>
                </div>

                {/* Upcoming + Pie — stacked on mobile, side-by-side on desktop */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                  gap: isMobile ? 12 : 16,
                }}>

                  {/* Upcoming payments */}
                  <div style={S.card}>
                    <span style={{ ...S.label, color: "#c4a24a" }}>Upcoming · 60 days</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {upcoming.slice(0, isMobile ? 6 : 9).map((e, i) => (
                        <div key={i} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "9px 12px", background: "#0e1019", borderRadius: 8,
                          borderLeft: `3px solid ${CAT_COLORS[e.category] || "#4a4f6a"}`,
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14 }}>{e.name}</span>
                              <FreqBadge freq={e.frequency} />
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span style={{ ...S.mono, fontSize: 9, color: "#3a3f5a" }}>{e.nextDue}</span>
                              <span style={{ ...S.mono, fontSize: 9, background: "#191d2e", padding: "1px 5px", borderRadius: 4, color: "#7a8299" }}>
                                {daysLabel(e.nextDue)}
                              </span>
                            </div>
                          </div>
                          <div style={{ ...S.mono, fontSize: 13, color: e.type === "income" ? "#4ade80" : "#f87171", marginLeft: 12, flexShrink: 0 }}>
                            {e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}
                          </div>
                        </div>
                      ))}
                      {upcoming.length === 0 && (
                        <div style={{ color: "#3a3f5a", fontSize: 13, padding: 20, textAlign: "center" }}>No upcoming payments</div>
                      )}
                    </div>
                  </div>

                  {/* Expense breakdown pie */}
                  <div style={S.card}>
                    <span style={{ ...S.label, color: "#c4a24a" }}>Expense Breakdown / Month</span>
                    <ResponsiveContainer width="100%" height={isMobile ? 140 : 160}>
                      <PieChart>
                        <Pie
                          data={catData}
                          cx="50%" cy="50%"
                          innerRadius={isMobile ? 38 : 44}
                          outerRadius={isMobile ? 60 : 68}
                          dataKey="value"
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip
                          formatter={v => [fmt(v), "Monthly"]}
                          contentStyle={{ background: "#12141e", border: "1px solid #252840", borderRadius: 8, ...S.mono, fontSize: 11, color: "#ddd8cc" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {catData.slice(0, isMobile ? 4 : 6).map(c => (
                        <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
                            <span style={{ ...S.mono, fontSize: 10, color: "#7a8299" }}>{c.name}</span>
                          </div>
                          <span style={{ ...S.mono, fontSize: 10 }}>{fmt(c.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* ─────────────────── PAYMENTS TAB ──────────────────────────── */}
            {tab === "payments" && (
              <div>
                {/* Type filter + Add button */}
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 12,
                  gap: 8, flexWrap: "wrap",
                }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[["all","All"],["income","Income"],["expense","Expenses"]].map(([v,l]) => (
                      <button key={v} onClick={() => setFilterType(v)} style={{
                        background: filterType === v ? "#c4a24a" : "#12141e",
                        color: filterType === v ? "#0b0d14" : "#3a3f5a",
                        border: "1px solid " + (filterType === v ? "#c4a24a" : "#191d2e"),
                        borderRadius: 8, padding: "7px 14px", cursor: "pointer",
                        ...S.mono, fontSize: 11, letterSpacing: 1,
                      }}>{l}</button>
                    ))}
                  </div>
                  <button
                    onClick={openAdd}
                    style={{ background: "#c4a24a", color: "#0b0d14", border: "none", borderRadius: 9, padding: "9px 18px", ...S.mono, fontSize: 11, cursor: "pointer", letterSpacing: 1, fontWeight: 700 }}
                  >+ Add</button>
                </div>

                {/* Rhythm filter — frequency as a first-class dimension */}
                <div style={{
                  background: "#12141e", border: "1px solid #191d2e",
                  borderRadius: 10, padding: "10px 14px", marginBottom: 14,
                  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                }}>
                  <span style={{ ...S.mono, fontSize: 9, color: "#3a3f5a", letterSpacing: 1.5, textTransform: "uppercase" }}>
                    Rhythm:
                  </span>
                  <button
                    onClick={() => setFreqFilter("all")}
                    style={{
                      borderRadius: 5, padding: "3px 10px",
                      ...S.mono, fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                      cursor: "pointer", border: "1px solid",
                      background: freqFilter === "all" ? "#252840" : "transparent",
                      color: freqFilter === "all" ? "#ddd8cc" : "#3a3f5a",
                      borderColor: "#252840",
                    }}
                  >All</button>
                  {FREQUENCIES.map(f => {
                    const active = freqFilter === f;
                    const meta   = FREQ_META[f];
                    return (
                      <button key={f} onClick={() => setFreqFilter(f)} style={{
                        borderRadius: 5, padding: "3px 10px",
                        ...S.mono, fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                        cursor: "pointer", border: "1px solid",
                        background:   active ? meta.color + "22" : "transparent",
                        color:        active ? meta.color         : "#3a3f5a",
                        borderColor:  active ? meta.color + "55" : "#252840",
                      }}>{meta.label}</button>
                    );
                  })}
                </div>

                {/* Entry list */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {listEntries.length === 0 && (
                    <div style={{ color: "#3a3f5a", textAlign: "center", padding: 40 }}>
                      No entries match current filters
                    </div>
                  )}
                  {listEntries.map(e => (
                    <div key={e.id} style={{ background: "#12141e", border: "1px solid #191d2e", borderRadius: 11, padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ width: 4, height: 44, borderRadius: 3, background: CAT_COLORS[e.category] || "#4a4f6a", flexShrink: 0, marginTop: 2 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 15 }}>{e.name}</span>
                            <FreqBadge freq={e.frequency} />
                          </div>
                          <div style={{ ...S.mono, fontSize: 11, marginBottom: 3 }}>
                            <span style={{ color: e.type === "income" ? "#4ade80" : "#f87171" }}>
                              {e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}
                            </span>
                            <span style={{ color: "#3a3f5a" }}> · {fmt(toMonthly(e.amount, e.frequency))}/mo equiv</span>
                          </div>
                          <div style={{ ...S.mono, fontSize: 9, color: "#3a3f5a" }}>
                            {e.category} · Next {e.nextDue}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button onClick={() => openEdit(e)} style={{ background: "#191d2e", border: "1px solid #252840", color: "#c4a24a", borderRadius: 7, padding: "6px 10px", cursor: "pointer", ...S.mono, fontSize: 10 }}>Edit</button>
                          <button onClick={() => deleteEntry(e.id)} style={{ background: "#191d2e", border: "1px solid #252840", color: "#f87171", borderRadius: 7, padding: "6px 10px", cursor: "pointer", ...S.mono, fontSize: 10 }}>×</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary footer */}
                <div style={{
                  marginTop: 20, background: "#12141e", border: "1px solid #191d2e",
                  borderRadius: 11, padding: "14px 20px",
                  display: "flex", justifyContent: "space-around", flexWrap: "wrap", gap: 12,
                }}>
                  {[
                    { label: "Total Income",   val: fmt(monthlyIncome)   + "/mo", color: "#4ade80" },
                    { label: "Total Expenses", val: fmt(monthlyExpenses) + "/mo", color: "#f87171" },
                    { label: "Net Position",   val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet) + "/mo", color: monthlyNet >= 0 ? "#4ade80" : "#f87171" },
                  ].map(c => (
                    <div key={c.label} style={{ textAlign: "center" }}>
                      <div style={{ ...S.mono, fontSize: 9, color: "#3a3f5a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>{c.label}</div>
                      <div style={{ ...S.mono, fontSize: isMobile ? 13 : 15, color: c.color }}>{c.val}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ─────────────────── CASH FLOW TAB ─────────────────────────── */}
            {tab === "cashflow" && (
              <div>
                <div style={{ ...S.mono, fontSize: 9, letterSpacing: 2.5, color: "#c4a24a", textTransform: "uppercase", marginBottom: isMobile ? 14 : 20 }}>
                  Cash Flow · Next 90 Days
                </div>
                {Object.entries(cfWeeks).map(([weekStart, evts], wi) => {
                  const wDate = new Date(weekStart);
                  const wIncome   = evts.filter(e => e.type === "income").reduce((s, e) => s + e.amount, 0);
                  const wExpenses = evts.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0);
                  const wNet      = wIncome - wExpenses;
                  const weekLabel = wi === 0
                    ? "This Week"
                    : wDate.toLocaleDateString("en-AU", {
                        weekday: isMobile ? "short" : "long",
                        month: "short",
                        day: "numeric",
                      });
                  return (
                    <div key={weekStart} style={{ ...S.card, marginBottom: 14, borderRadius: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                        <div style={{ ...S.mono, fontSize: isMobile ? 11 : 12 }}>{weekLabel}</div>
                        <div style={{ display: "flex", gap: 12 }}>
                          {wIncome   > 0 && <span style={{ ...S.mono, fontSize: 10, color: "#4ade80" }}>+{fmt(wIncome)}</span>}
                          {wExpenses > 0 && <span style={{ ...S.mono, fontSize: 10, color: "#f87171" }}>–{fmt(wExpenses)}</span>}
                          <span style={{ ...S.mono, fontSize: 10, color: wNet >= 0 ? "#4ade80" : "#f87171", borderLeft: "1px solid #252840", paddingLeft: 12 }}>
                            {wNet >= 0 ? "+" : "–"}{fmt(wNet)} net
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {evts.map((e, i) => (
                          <div key={i} style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "8px 10px", background: "#0e1019", borderRadius: 7,
                            flexWrap: isMobile ? "wrap" : "nowrap", gap: 6,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
                              <div style={{ width: 7, height: 7, borderRadius: "50%", background: CAT_COLORS[e.category] || "#4a4f6a", flexShrink: 0 }} />
                              <span style={{ fontSize: 14 }}>{e.name}</span>
                              <FreqBadge freq={e.frequency} />
                              <span style={{ ...S.mono, fontSize: 9, color: "#3a3f5a" }}>{e.dueStr}</span>
                            </div>
                            <span style={{ ...S.mono, fontSize: 13, color: e.type === "income" ? "#4ade80" : "#f87171", flexShrink: 0 }}>
                              {e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {cfEvents.length === 0 && (
                  <div style={{ color: "#3a3f5a", textAlign: "center", padding: 40 }}>No upcoming cash flows</div>
                )}
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── MOBILE BOTTOM NAV ──────────────────────────────────────────────── */}
      {isMobile && (
        <div style={{
          flexShrink: 0,
          background: "#0f1119",
          borderTop: "1px solid #191d2e",
          display: "flex",
        }}>
          {TABS.map(({ key, icon, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", gap: 3,
                background: "none", border: "none",
                padding: "10px 8px", cursor: "pointer",
                ...S.mono, fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                color: tab === key ? "#c4a24a" : "#3a3f5a",
                transition: "color .15s",
              }}
            >
              <span style={{ fontSize: 17, lineHeight: 1 }}>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── MODAL ──────────────────────────────────────────────────────────── */}
      {modal && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(5,6,12,0.85)",
            display: "flex",
            alignItems: isMobile ? "flex-end" : "center",
            justifyContent: "center",
            zIndex: 200,
            padding: isMobile ? 0 : 24,
          }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div style={{
            background: "#12141e", border: "1px solid #252840",
            borderRadius: isMobile ? "16px 16px 0 0" : 16,
            padding: "24px 22px",
            width: "100%",
            maxWidth: isMobile ? "100%" : 460,
            ...(isMobile ? { maxHeight: "92dvh", overflowY: "auto" } : {}),
          }}>
            <div style={{ ...S.mono, fontSize: 9, letterSpacing: 3, color: "#c4a24a", textTransform: "uppercase", marginBottom: 20 }}>
              {modal === "add" ? "Add New Entry" : "Edit Entry"}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <span style={S.label}>Name</span>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Netflix, Rent, Salary…"
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <span style={S.label}>Type</span>
                  <select
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value, category: e.target.value === "income" ? "Salary" : "Housing" }))}
                  >
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
                    {(CATEGORIES[form.type] || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <span style={S.label}>Next Due Date</span>
                <input type="date" value={form.nextDue} onChange={e => setForm(f => ({ ...f, nextDue: e.target.value }))} />
              </div>

              {/* Live conversion preview with FreqBadge */}
              {form.amount && (
                <div style={{
                  background: "#0e1019", borderRadius: 9, padding: "12px 14px",
                  ...S.mono, fontSize: 11, color: "#3a3f5a",
                  display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                }}>
                  <FreqBadge freq={form.frequency} />
                  <span style={{ color: "#ddd8cc" }}>{fmtFull(parseFloat(form.amount) || 0)}</span>
                  <span>= <span style={{ color: form.type === "income" ? "#4ade80" : "#f87171" }}>
                    {fmt(toMonthly(parseFloat(form.amount) || 0, form.frequency))}/mo
                  </span></span>
                  <span>· <span style={{ color: "#c4a24a" }}>
                    {fmt(toMonthly(parseFloat(form.amount) || 0, form.frequency) * 12)}/yr
                  </span></span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                onClick={() => setModal(null)}
                style={{ flex: 1, background: "#191d2e", border: "1px solid #252840", color: "#7a8299", borderRadius: 9, padding: "12px", ...S.mono, fontSize: 11, cursor: "pointer" }}
              >Cancel</button>
              <button
                onClick={saveEntry}
                style={{ flex: 2, background: "#c4a24a", border: "none", color: "#0b0d14", borderRadius: 9, padding: "12px", ...S.mono, fontSize: 11, cursor: "pointer", fontWeight: 700, letterSpacing: 1 }}
              >Save Entry</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
