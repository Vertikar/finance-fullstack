import { useState, useEffect } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const FREQUENCIES = ["weekly", "fortnightly", "monthly", "quarterly", "yearly"];
const FREQ_LABELS = { weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

const CATEGORIES = {
  income: ["Salary", "Freelance", "Investment", "Rental", "Government", "Other Income"],
  expense: ["Housing", "Transport", "Food & Groceries", "Utilities", "Insurance", "Health", "Entertainment", "Subscriptions", "Education", "Savings", "Clothing", "Other"]
};

const CAT_COLORS = {
  "Salary": "#4ade80", "Freelance": "#34d399", "Investment": "#6ee7b7",
  "Rental": "#a7f3d0", "Government": "#86efac", "Other Income": "#d1fae5",
  "Housing": "#f87171", "Transport": "#fb923c", "Food & Groceries": "#fbbf24",
  "Utilities": "#a78bfa", "Insurance": "#60a5fa", "Health": "#f472b6",
  "Entertainment": "#c084fc", "Subscriptions": "#22d3ee", "Education": "#818cf8",
  "Savings": "#4ade80", "Clothing": "#f9a8d4", "Other": "#94a3b8"
};

// ── Theme palettes ─────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg:              "#0b0d14",
    bgHeader:        "#0f1119",
    bgCard:          "#12141e",
    bgInner:         "#0e1019",
    bgSubtle:        "#191d2e",
    border:          "#191d2e",
    border2:         "#252840",
    text:            "#ddd8cc",
    textMuted:       "#3a3f5a",
    textVeryMuted:   "#2e3350",
    textMid:         "#7a8299",
    accent:          "#c4a24a",
    accentText:      "#0b0d14",
    income:          "#4ade80",
    expense:         "#f87171",
    warn:            "#fbbf24",
    scrollThumb:     "#222536",
    badgeBg:         "#191d2e",
    badgeTxt:        "#3a3f5a",
    inputBg:         "#14172280",
    inputBorder:     "#252840",
    tooltipBg:       "#12141e",
    tooltipBorder:   "#252840",
  },
  light: {
    bg:              "#f5f2ec",
    bgHeader:        "#ffffff",
    bgCard:          "#ffffff",
    bgInner:         "#f7f4ee",
    bgSubtle:        "#ece8df",
    border:          "#e2ddd4",
    border2:         "#ccc7bc",
    text:            "#1a1610",
    textMuted:       "#9a9080",
    textVeryMuted:   "#c0b8ae",
    textMid:         "#6a6258",
    accent:          "#9a7830",
    accentText:      "#ffffff",
    income:          "#16a34a",
    expense:         "#dc2626",
    warn:            "#b45309",
    scrollThumb:     "#ccc7bc",
    badgeBg:         "#ece8df",
    badgeTxt:        "#8a8070",
    inputBg:         "#f7f4ee",
    inputBorder:     "#ccc7bc",
    tooltipBg:       "#ffffff",
    tooltipBorder:   "#e2ddd4",
  }
};

function toMonthly(amount, freq) {
  const m = { weekly: 52/12, fortnightly: 26/12, monthly: 1, quarterly: 1/3, yearly: 1/12 };
  return amount * (m[freq] || 1);
}

function addFreq(date, freq) {
  const d = new Date(date);
  if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "fortnightly") d.setDate(d.getDate() + 14);
  else if (freq === "monthly") d.setMonth(d.getMonth() + 1);
  else if (freq === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  return d;
}

const SAMPLE_DATA = [
  { id: "s1",  name: "Salary",         amount: 5500, type: "income",  frequency: "monthly",     category: "Salary",           nextDue: "2026-05-31" },
  { id: "s2",  name: "Freelance",      amount: 800,  type: "income",  frequency: "monthly",     category: "Freelance",        nextDue: "2026-05-28" },
  { id: "s3",  name: "Rent",           amount: 1800, type: "expense", frequency: "monthly",     category: "Housing",          nextDue: "2026-06-01" },
  { id: "s4",  name: "Car Loan",       amount: 450,  type: "expense", frequency: "fortnightly", category: "Transport",        nextDue: "2026-05-24" },
  { id: "s5",  name: "Netflix",        amount: 18,   type: "expense", frequency: "monthly",     category: "Subscriptions",    nextDue: "2026-06-05" },
  { id: "s6",  name: "Spotify",        amount: 12,   type: "expense", frequency: "monthly",     category: "Subscriptions",    nextDue: "2026-06-08" },
  { id: "s7",  name: "Car Insurance",  amount: 1200, type: "expense", frequency: "yearly",      category: "Insurance",        nextDue: "2026-09-15" },
  { id: "s8",  name: "Health Insurance", amount: 350, type: "expense", frequency: "quarterly",  category: "Health",           nextDue: "2026-07-01" },
  { id: "s9",  name: "Electricity",   amount: 180,  type: "expense", frequency: "quarterly",   category: "Utilities",        nextDue: "2026-06-15" },
  { id: "s10", name: "Gym",            amount: 55,   type: "expense", frequency: "monthly",     category: "Health",           nextDue: "2026-06-01" },
  { id: "s11", name: "Groceries",      amount: 320,  type: "expense", frequency: "fortnightly", category: "Food & Groceries", nextDue: "2026-05-25" },
];

const fmt = (n) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Math.abs(n));
const fmtFull = (n) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
const EMPTY_FORM = { name: "", amount: "", type: "expense", frequency: "monthly", category: "Housing", nextDue: new Date().toISOString().split("T")[0] };

// ── Sun / Moon SVG icons ───────────────────────────────────────────────────────
function SunIcon({ color }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}
function MoonIcon({ color }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

export default function FinanceManager() {
  const [entries, setEntries]     = useState(SAMPLE_DATA);
  const [tab, setTab]             = useState("dashboard");
  const [modal, setModal]         = useState(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [loaded, setLoaded]       = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [themeKey, setThemeKey]   = useState("dark");

  const T = THEMES[themeKey];

  // ── Persist entries & theme ──────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("fin_entries_v2");
        if (res?.value) setEntries(JSON.parse(res.value));
        const tRes = await window.storage.get("fin_theme");
        if (tRes?.value) setThemeKey(tRes.value);
      } catch {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.storage.set("fin_entries_v2", JSON.stringify(entries)).catch(() => {});
  }, [entries, loaded]);

  function toggleTheme() {
    const next = themeKey === "dark" ? "light" : "dark";
    setThemeKey(next);
    window.storage.set("fin_theme", next).catch(() => {});
  }

  // ── Calculations ─────────────────────────────────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const income   = entries.filter(e => e.type === "income");
  const expenses = entries.filter(e => e.type === "expense");
  const monthlyIncome   = income.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const monthlyExpenses = expenses.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const monthlyNet  = monthlyIncome - monthlyExpenses;
  const savingsRate = monthlyIncome > 0 ? (monthlyNet / monthlyIncome) * 100 : 0;

  const upcoming = entries
    .map(e => ({ ...e, due: new Date(e.nextDue) }))
    .filter(e => { const d = (e.due - today) / 86400000; return d >= 0 && d <= 60; })
    .sort((a, b) => a.due - b.due);

  const catTotals = {};
  expenses.forEach(e => { catTotals[e.category] = (catTotals[e.category] || 0) + toMonthly(e.amount, e.frequency); });
  const catData = Object.entries(catTotals)
    .map(([name, value]) => ({ name, value: Math.round(value), color: CAT_COLORS[name] || "#94a3b8" }))
    .sort((a, b) => b.value - a.value);

  // ── Cash flow ────────────────────────────────────────────────────────────────
  const cfEnd = new Date(today); cfEnd.setDate(cfEnd.getDate() + 90);
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
  const cfMonths = {};
  cfEvents.forEach(e => { const k = e.dueStr.slice(0, 7); if (!cfMonths[k]) cfMonths[k] = []; cfMonths[k].push(e); });

  const listEntries = filterType === "all" ? entries : entries.filter(e => e.type === filterType);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function daysLabel(dateStr) {
    const d = Math.round((new Date(dateStr) - today) / 86400000);
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    return `${d}d`;
  }

  function openAdd() { setForm({ ...EMPTY_FORM, nextDue: new Date().toISOString().split("T")[0] }); setModal("add"); }
  function openEdit(e) { setForm({ ...e }); setModal("edit"); }
  function saveEntry() {
    if (!form.name.trim() || !form.amount) return;
    const entry = { ...form, amount: parseFloat(form.amount), id: form.id || Date.now().toString() };
    if (modal === "add") setEntries(p => [...p, entry]);
    else setEntries(p => p.map(e => e.id === entry.id ? entry : e));
    setModal(null);
  }
  function deleteEntry(id) { setEntries(p => p.filter(e => e.id !== id)); }

  // ── Dynamic CSS ──────────────────────────────────────────────────────────────
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400;600&family=DM+Mono:wght@300;400;500&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 3px; }
    ::-webkit-scrollbar-thumb { background: ${T.scrollThumb}; border-radius: 2px; }
    .fin-input, .fin-select {
      background: ${T.inputBg} !important;
      border: 1px solid ${T.inputBorder} !important;
      color: ${T.text} !important;
      border-radius: 8px;
      padding: 9px 13px;
      font-family: 'DM Mono', monospace;
      font-size: 13px;
      outline: none;
      width: 100%;
      transition: border-color .2s;
      appearance: auto;
    }
    .fin-input:focus, .fin-select:focus { border-color: ${T.accent} !important; }
    .fin-input::placeholder { color: ${T.textMuted}; }
    .fin-select option { background: ${T.bgCard}; color: ${T.text}; }
    .fin-btn-ghost {
      background: none; border: none;
      cursor: pointer; font-family: 'DM Mono', monospace;
      font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
      transition: color .15s;
    }
    .theme-toggle {
      display: flex; align-items: center; gap: 6px;
      background: ${T.bgSubtle}; border: 1px solid ${T.border2};
      border-radius: 20px; padding: 5px 12px 5px 8px;
      cursor: pointer; transition: background .2s, border-color .2s;
      font-family: 'DM Mono', monospace; font-size: 10px;
      color: ${T.textMid}; letter-spacing: 1px;
    }
    .theme-toggle:hover { border-color: ${T.accent}; color: ${T.accent}; }
    button:active { opacity: 0.85; transform: scale(0.98); }
  `;

  const mono = "'DM Mono', monospace";

  // ── Re-usable style fragments ─────────────────────────────────────────────
  const card = {
    background: T.bgCard,
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    padding: "18px 20px",
  };
  const label = {
    fontFamily: mono, fontSize: 9, letterSpacing: 2.5,
    color: T.textMuted, textTransform: "uppercase", marginBottom: 10,
  };

  return (
    <div style={{ fontFamily: "'Crimson Pro', Georgia, serif", background: T.bg, minHeight: "100vh", color: T.text, transition: "background .25s, color .25s" }}>
      <style>{css}</style>

      {/* ── HEADER ── */}
      <div style={{ background: T.bgHeader, borderBottom: `1px solid ${T.border}`, padding: "18px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "background .25s" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 3.5, color: T.accent, textTransform: "uppercase", marginBottom: 5 }}>Personal Finance</div>
          <div style={{ fontSize: 24, fontWeight: 300, letterSpacing: .5, color: T.text }}>My Money Dashboard</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.textMuted }}>
              {today.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: monthlyNet >= 0 ? T.income : T.expense }} />
              <span style={{ fontFamily: mono, fontSize: 11, color: monthlyNet >= 0 ? T.income : T.expense }}>
                {monthlyNet >= 0 ? "+" : "–"}{fmt(monthlyNet)}/mo net
              </span>
            </div>
          </div>
          {/* Theme toggle */}
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            {themeKey === "dark" ? <SunIcon color={T.textMid} /> : <MoonIcon color={T.textMid} />}
            {themeKey === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{ display: "flex", background: T.bgHeader, borderBottom: `1px solid ${T.border}`, padding: "0 20px", transition: "background .25s" }}>
        {[["dashboard", "Overview"], ["payments", "Payments"], ["cashflow", "Cash Flow"]].map(([key, lbl]) => (
          <button key={key} className="fin-btn-ghost" onClick={() => setTab(key)} style={{
            color: tab === key ? T.accent : T.textMuted,
            padding: "14px 18px",
            borderBottom: tab === key ? `2px solid ${T.accent}` : "2px solid transparent",
          }}>{lbl}</button>
        ))}
      </div>

      <div style={{ padding: "24px 28px", maxWidth: 960, margin: "0 auto" }}>

        {/* ══ DASHBOARD ══ */}
        {tab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* KPI row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
              {[
                { lbl: "Monthly Income",   val: fmt(monthlyIncome),                              sub: `${fmt(monthlyIncome * 12)}/yr`,          color: T.income  },
                { lbl: "Monthly Expenses", val: fmt(monthlyExpenses),                            sub: `${fmt(monthlyExpenses * 12)}/yr`,        color: T.expense },
                { lbl: "Monthly Net",      val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet), sub: `${savingsRate.toFixed(1)}% savings rate`, color: monthlyNet >= 0 ? T.income : T.expense },
                { lbl: "Annual Net",       val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet * 12), sub: `${entries.length} recurring entries`, color: T.accent },
              ].map(c => (
                <div key={c.lbl} style={{ ...card }}>
                  <div style={label}>{c.lbl}</div>
                  <div style={{ fontFamily: mono, fontSize: 20, fontWeight: 500, color: c.color, marginBottom: 6 }}>{c.val}</div>
                  <div style={{ fontFamily: mono, fontSize: 9, color: T.textVeryMuted }}>{c.sub}</div>
                </div>
              ))}
            </div>

            {/* Savings bar */}
            <div style={{ ...card }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={label}>Savings Rate</div>
                <div style={{ fontFamily: mono, fontSize: 12, color: savingsRate >= 20 ? T.income : savingsRate >= 10 ? T.warn : T.expense }}>
                  {savingsRate.toFixed(1)}%
                </div>
              </div>
              <div style={{ background: T.bgSubtle, borderRadius: 6, height: 8, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, Math.max(0, savingsRate))}%`,
                  background: savingsRate >= 20 ? T.income : savingsRate >= 10 ? T.warn : T.expense,
                  borderRadius: 6, transition: "width .5s ease",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontFamily: mono, fontSize: 9, color: T.textMuted }}>
                <span>0%</span>
                <span style={{ color: T.warn }}>10% good</span>
                <span style={{ color: T.income }}>20% great</span>
                <span>100%</span>
              </div>
            </div>

            {/* Bottom two columns */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

              {/* Upcoming payments */}
              <div style={{ ...card }}>
                <div style={{ ...label, color: T.accent, marginBottom: 16 }}>Upcoming (60 days)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {upcoming.slice(0, 9).map((e, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "9px 12px", background: T.bgInner, borderRadius: 8,
                      borderLeft: `3px solid ${CAT_COLORS[e.category] || "#4a4f6a"}`,
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.text }}>{e.name}</div>
                        <div style={{ fontFamily: mono, fontSize: 9, color: T.textMuted }}>{e.nextDue} · {daysLabel(e.nextDue)}</div>
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 13, color: e.type === "income" ? T.income : T.expense, marginLeft: 12, flexShrink: 0 }}>
                        {e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}
                      </div>
                    </div>
                  ))}
                  {upcoming.length === 0 && (
                    <div style={{ color: T.textMuted, fontSize: 13, padding: 20, textAlign: "center" }}>No upcoming payments</div>
                  )}
                </div>
              </div>

              {/* Category chart */}
              <div style={{ ...card }}>
                <div style={{ ...label, color: T.accent, marginBottom: 12 }}>Expense Breakdown / Month</div>
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie data={catData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" paddingAngle={2} strokeWidth={0}>
                      {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v) => [fmt(v), "Monthly"]}
                      contentStyle={{ background: T.tooltipBg, border: `1px solid ${T.tooltipBorder}`, borderRadius: 8, fontFamily: mono, fontSize: 11, color: T.text }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 4 }}>
                  {catData.slice(0, 6).map(c => (
                    <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }} />
                        <span style={{ fontFamily: mono, fontSize: 10, color: T.textMid }}>{c.name}</span>
                      </div>
                      <span style={{ fontFamily: mono, fontSize: 10, color: T.text }}>{fmt(c.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ PAYMENTS ══ */}
        {tab === "payments" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 8 }}>
                {[["all", "All"], ["income", "Income"], ["expense", "Expenses"]].map(([v, l]) => (
                  <button key={v} onClick={() => setFilterType(v)} style={{
                    background: filterType === v ? T.accent : T.bgCard,
                    color: filterType === v ? T.accentText : T.textMuted,
                    border: `1px solid ${filterType === v ? T.accent : T.border}`,
                    borderRadius: 8, padding: "7px 16px", cursor: "pointer",
                    fontFamily: mono, fontSize: 11, letterSpacing: 1, transition: "all .15s",
                  }}>{l}</button>
                ))}
              </div>
              <button onClick={openAdd} style={{
                background: T.accent, color: T.accentText, border: "none",
                borderRadius: 9, padding: "9px 20px", fontFamily: mono,
                fontSize: 11, cursor: "pointer", letterSpacing: 1, fontWeight: 600,
              }}>+ Add Entry</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {listEntries.length === 0 && (
                <div style={{ color: T.textMuted, textAlign: "center", padding: 40, fontSize: 14 }}>No entries yet — add one above</div>
              )}
              {listEntries.map(e => (
                <div key={e.id} style={{
                  background: T.bgCard, border: `1px solid ${T.border}`,
                  borderRadius: 11, padding: "14px 18px",
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
                  transition: "background .25s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }}>
                    <div style={{ width: 4, height: 38, borderRadius: 3, background: CAT_COLORS[e.category] || "#4a4f6a", flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, marginBottom: 3, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</div>
                      <div style={{ fontFamily: mono, fontSize: 9, color: T.textMuted, letterSpacing: 1 }}>
                        {e.category} · {FREQ_LABELS[e.frequency]} · Next {e.nextDue}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: mono, fontSize: 16, color: e.type === "income" ? T.income : T.expense }}>
                        {e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 9, color: T.textMuted }}>{fmt(toMonthly(e.amount, e.frequency))}/mo equiv</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => openEdit(e)} style={{
                        background: T.bgSubtle, border: `1px solid ${T.border2}`,
                        color: T.accent, borderRadius: 7, padding: "6px 12px",
                        cursor: "pointer", fontFamily: mono, fontSize: 10,
                      }}>Edit</button>
                      <button onClick={() => deleteEntry(e.id)} style={{
                        background: T.bgSubtle, border: `1px solid ${T.border2}`,
                        color: T.expense, borderRadius: 7, padding: "6px 12px",
                        cursor: "pointer", fontFamily: mono, fontSize: 10,
                      }}>×</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Summary footer */}
            <div style={{ marginTop: 20, background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 11, padding: "14px 20px", display: "flex", justifyContent: "space-around" }}>
              {[
                { lbl: "Total Income",   val: fmt(monthlyIncome) + "/mo",                                   color: T.income  },
                { lbl: "Total Expenses", val: fmt(monthlyExpenses) + "/mo",                                  color: T.expense },
                { lbl: "Net Position",   val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet) + "/mo", color: monthlyNet >= 0 ? T.income : T.expense },
              ].map(c => (
                <div key={c.lbl} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: mono, fontSize: 9, color: T.textMuted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>{c.lbl}</div>
                  <div style={{ fontFamily: mono, fontSize: 15, color: c.color }}>{c.val}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ CASH FLOW ══ */}
        {tab === "cashflow" && (
          <div>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 2.5, color: T.accent, textTransform: "uppercase", marginBottom: 20 }}>
              Cash Flow · Next 90 Days
            </div>
            {Object.entries(cfMonths).map(([monthKey, evts]) => {
              const mIncome   = evts.filter(e => e.type === "income").reduce((s, e) => s + e.amount, 0);
              const mExpenses = evts.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0);
              const mNet = mIncome - mExpenses;
              const monthLabel = new Date(monthKey + "-01").toLocaleDateString("en-AU", { month: "long", year: "numeric" });
              return (
                <div key={monthKey} style={{ ...card, marginBottom: 16, borderRadius: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div style={{ fontFamily: mono, fontSize: 12, color: T.text }}>{monthLabel}</div>
                    <div style={{ display: "flex", gap: 16 }}>
                      {mIncome   > 0 && <span style={{ fontFamily: mono, fontSize: 11, color: T.income  }}>+{fmt(mIncome)}</span>}
                      {mExpenses > 0 && <span style={{ fontFamily: mono, fontSize: 11, color: T.expense }}>–{fmt(mExpenses)}</span>}
                      <span style={{ fontFamily: mono, fontSize: 11, color: mNet >= 0 ? T.income : T.expense, borderLeft: `1px solid ${T.border2}`, paddingLeft: 14 }}>
                        {mNet >= 0 ? "+" : "–"}{fmt(mNet)} net
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {evts.map((e, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: T.bgInner, borderRadius: 7 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: CAT_COLORS[e.category] || "#4a4f6a", flexShrink: 0 }} />
                          <span style={{ fontSize: 14, color: T.text }}>{e.name}</span>
                          <span style={{ fontFamily: mono, fontSize: 9, color: T.textMuted }}>{e.dueStr}</span>
                          <span style={{ fontFamily: mono, fontSize: 9, color: T.badgeTxt, background: T.badgeBg, borderRadius: 4, padding: "2px 6px" }}>
                            {FREQ_LABELS[e.frequency]}
                          </span>
                        </div>
                        <span style={{ fontFamily: mono, fontSize: 13, color: e.type === "income" ? T.income : T.expense, flexShrink: 0 }}>
                          {e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {cfEvents.length === 0 && (
              <div style={{ color: T.textMuted, textAlign: "center", padding: 40 }}>No upcoming cash flows — add entries in the Payments tab</div>
            )}
          </div>
        )}
      </div>

      {/* ══ MODAL ══ */}
      {modal && (
        <div
          style={{ position: "fixed", inset: 0, background: themeKey === "dark" ? "rgba(5,6,12,0.85)" : "rgba(20,18,14,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div style={{ background: T.bgCard, border: `1px solid ${T.border2}`, borderRadius: 16, padding: "28px 30px", width: "100%", maxWidth: 460, transition: "background .25s" }}>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: 3, color: T.accent, textTransform: "uppercase", marginBottom: 22 }}>
              {modal === "add" ? "Add New Entry" : "Edit Entry"}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ ...label, marginBottom: 7 }}>Name</div>
                <input className="fin-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Netflix, Rent, Salary…" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ ...label, marginBottom: 7 }}>Type</div>
                  <select className="fin-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, category: e.target.value === "income" ? "Salary" : "Housing" }))}>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div>
                  <div style={{ ...label, marginBottom: 7 }}>Amount ($)</div>
                  <input className="fin-input" type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ ...label, marginBottom: 7 }}>Frequency</div>
                  <select className="fin-select" value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                    {FREQUENCIES.map(f => <option key={f} value={f}>{FREQ_LABELS[f]}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ ...label, marginBottom: 7 }}>Category</div>
                  <select className="fin-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    {(CATEGORIES[form.type] || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <div style={{ ...label, marginBottom: 7 }}>Next Due Date</div>
                <input className="fin-input" type="date" value={form.nextDue} onChange={e => setForm(f => ({ ...f, nextDue: e.target.value }))} />
              </div>

              {/* Live preview */}
              {form.amount && (
                <div style={{ background: T.bgInner, borderRadius: 9, padding: "12px 14px", fontFamily: mono, fontSize: 11, color: T.textMuted, border: `1px solid ${T.border}` }}>
                  <span style={{ color: T.text }}>{fmtFull(parseFloat(form.amount) || 0)} {FREQ_LABELS[form.frequency]}</span>
                  {" = "}
                  <span style={{ color: form.type === "income" ? T.income : T.expense }}>{fmt(toMonthly(parseFloat(form.amount) || 0, form.frequency))}/mo</span>
                  {" · "}
                  <span style={{ color: T.accent }}>{fmt(toMonthly(parseFloat(form.amount) || 0, form.frequency) * 12)}/yr</span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
              <button onClick={() => setModal(null)} style={{
                flex: 1, background: T.bgSubtle, border: `1px solid ${T.border2}`,
                color: T.textMid, borderRadius: 9, padding: "12px",
                fontFamily: mono, fontSize: 11, cursor: "pointer",
              }}>Cancel</button>
              <button onClick={saveEntry} style={{
                flex: 2, background: T.accent, border: "none", color: T.accentText,
                borderRadius: 9, padding: "12px", fontFamily: mono, fontSize: 11,
                cursor: "pointer", fontWeight: 700, letterSpacing: 1,
              }}>Save Entry</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
