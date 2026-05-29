import { useState, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "./api";
import AuthScreen from "./AuthScreen";

const FREQUENCIES = ["weekly", "fortnightly", "monthly", "quarterly", "biannual", "yearly"];
const FREQ_LABELS  = {
  weekly:      "Weekly",
  fortnightly: "Fortnightly",
  monthly:     "Monthly",
  quarterly:   "Quarterly",
  biannual:    "Biannual",
  yearly:      "Yearly",
};

const CATEGORIES = {
  income:  ["Salary", "Freelance", "Investment", "Rental", "Government", "Other Income"],
  expense: ["Housing", "Transport", "Food & Groceries", "Utilities", "Insurance",
            "Health", "Entertainment", "Subscriptions", "Education", "Savings", "Clothing", "Other"],
};

const CAT_COLORS = {
  "Salary": "#4ade80", "Freelance": "#34d399", "Investment": "#6ee7b7",
  "Rental": "#a7f3d0", "Government": "#86efac", "Other Income": "#d1fae5",
  "Housing": "#f87171", "Transport": "#fb923c", "Food & Groceries": "#fbbf24",
  "Utilities": "#a78bfa", "Insurance": "#60a5fa", "Health": "#f472b6",
  "Entertainment": "#c084fc", "Subscriptions": "#22d3ee", "Education": "#818cf8",
  "Savings": "#4ade80", "Clothing": "#f9a8d4", "Other": "#94a3b8",
};

function toMonthly(amount, freq) {
  const m = {
    weekly: 52/12, fortnightly: 26/12, monthly: 1,
    quarterly: 1/3, biannual: 1/6, yearly: 1/12,
  };
  return amount * (m[freq] || 1);
}

function addFreq(date, freq) {
  const d = new Date(date);
  if      (freq === "weekly")      d.setDate(d.getDate() + 7);
  else if (freq === "fortnightly") d.setDate(d.getDate() + 14);
  else if (freq === "monthly")     d.setMonth(d.getMonth() + 1);
  else if (freq === "quarterly")   d.setMonth(d.getMonth() + 3);
  else if (freq === "biannual")    d.setMonth(d.getMonth() + 6);
  else if (freq === "yearly")      d.setFullYear(d.getFullYear() + 1);
  return d;
}

const fmt     = (n) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Math.abs(n));
const fmtFull = (n) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
const EMPTY_FORM = { name: "", amount: "", type: "expense", frequency: "monthly", category: "Housing", nextDue: new Date().toISOString().split("T")[0] };

function getStoredUser() {
  try { return JSON.parse(localStorage.getItem("finance_user")); } catch { return null; }
}

export default function App() {
  const [user,       setUser]       = useState(getStoredUser);
  const [entries,    setEntries]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [tab,        setTab]        = useState("dashboard");
  const [modal,      setModal]      = useState(null);
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [filterType, setFilterType] = useState("all");
  const [apiError,   setApiError]   = useState("");

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

  useEffect(() => { if (user) loadEntries(); }, [user, loadEntries]);

  function handleLogout() {
    localStorage.removeItem("finance_token");
    localStorage.removeItem("finance_user");
    setUser(null);
    setEntries([]);
  }

  if (!user) return <AuthScreen onAuth={(u) => setUser(u)} />;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const income   = entries.filter(e => e.type === "income");
  const expenses = entries.filter(e => e.type === "expense");
  const monthlyIncome   = income.reduce((s, e)   => s + toMonthly(e.amount, e.frequency), 0);
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

  function daysLabel(dateStr) {
    const d = Math.round((new Date(dateStr) - today) / 86400000);
    if (d === 0) return "Today"; if (d === 1) return "Tomorrow"; return `${d}d`;
  }

  function openAdd()  { setForm({ ...EMPTY_FORM, nextDue: new Date().toISOString().split("T")[0] }); setModal("add"); }
  function openEdit(e){ setForm({ ...e }); setModal("edit"); }

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

  // Cash flow — next 90 days
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

  const S = {
    card:  { background: "#12141e", border: "1px solid #191d2e", borderRadius: 12, padding: "18px 20px" },
    label: { fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: 2.5, color: "#3a3f5a", textTransform: "uppercase", marginBottom: 10 },
    mono:  { fontFamily: "'DM Mono',monospace" },
  };

  return (
    <div style={{ fontFamily: "'Crimson Pro', Georgia, serif", background: "#0b0d14", minHeight: "100vh", color: "#ddd8cc" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400;600&family=DM+Mono:wght@300;400;500&display=swap'); * { box-sizing:border-box; margin:0; padding:0; } ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-thumb{background:#222536} input,select{background:#0e101980!important;border:1px solid #252840!important;color:#ddd8cc!important;border-radius:8px;padding:9px 13px;font-family:'DM Mono',monospace;font-size:13px;outline:none;width:100%;transition:border-color .2s} input:focus,select:focus{border-color:#c4a24a!important} input::placeholder{color:#3a3f5a} option{background:#14172280}`}</style>

      {/* HEADER */}
      <div style={{ background: "#0f1119", borderBottom: "1px solid #191d2e", padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ ...S.mono, fontSize: 9, letterSpacing: 3.5, color: "#c4a24a", textTransform: "uppercase", marginBottom: 4 }}>Personal Finance</div>
          <div style={{ fontSize: 22, fontWeight: 300 }}>My Money Dashboard</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ ...S.mono, fontSize: 10, color: "#3a3f5a" }}>{user.email}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: monthlyNet >= 0 ? "#4ade80" : "#f87171" }} />
              <span style={{ ...S.mono, fontSize: 11, color: monthlyNet >= 0 ? "#4ade80" : "#f87171" }}>{monthlyNet >= 0 ? "+" : "–"}{fmt(monthlyNet)}/mo</span>
            </div>
          </div>
          <button onClick={handleLogout} style={{ background: "#191d2e", border: "1px solid #252840", color: "#3a3f5a", borderRadius: 8, padding: "7px 14px", cursor: "pointer", ...S.mono, fontSize: 10 }}>Sign Out</button>
        </div>
      </div>

      {apiError && (
        <div style={{ background: "#2a1010", borderBottom: "1px solid #f8717133", padding: "10px 28px", display: "flex", justifyContent: "space-between", ...S.mono, fontSize: 11, color: "#f87171" }}>
          <span>⚠ {apiError}</span>
          <button onClick={() => setApiError("")} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* TABS */}
      <div style={{ display: "flex", background: "#0f1119", borderBottom: "1px solid #191d2e", padding: "0 20px" }}>
        {[["dashboard","Overview"],["payments","Payments"],["cashflow","Cash Flow"]].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: "none", border: "none", color: tab === key ? "#c4a24a" : "#3a3f5a",
            padding: "14px 18px", cursor: "pointer", ...S.mono, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase",
            borderBottom: tab === key ? "2px solid #c4a24a" : "2px solid transparent", transition: "color .15s",
          }}>{label}</button>
        ))}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 60, ...S.mono, fontSize: 11, color: "#3a3f5a", letterSpacing: 2 }}>Loading…</div>}

      {!loading && (
        <div style={{ padding: "24px 28px", maxWidth: 960, margin: "0 auto" }}>

          {/* ── DASHBOARD ── */}
          {tab === "dashboard" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                {[
                  { label: "Monthly Income",   val: fmt(monthlyIncome),   sub: `${fmt(monthlyIncome * 12)}/yr`,   color: "#4ade80" },
                  { label: "Monthly Expenses",  val: fmt(monthlyExpenses), sub: `${fmt(monthlyExpenses * 12)}/yr`, color: "#f87171" },
                  { label: "Monthly Net",       val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet), sub: `${savingsRate.toFixed(1)}% savings rate`, color: monthlyNet >= 0 ? "#4ade80" : "#f87171" },
                  { label: "Annual Net",        val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet * 12), sub: `${entries.length} recurring entries`, color: "#c4a24a" },
                ].map(c => (
                  <div key={c.label} style={S.card}>
                    <div style={S.label}>{c.label}</div>
                    <div style={{ ...S.mono, fontSize: 20, fontWeight: 500, color: c.color, marginBottom: 5 }}>{c.val}</div>
                    <div style={{ ...S.mono, fontSize: 9, color: "#2e3350" }}>{c.sub}</div>
                  </div>
                ))}
              </div>

              <div style={S.card}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={S.label}>Savings Rate</div>
                  <div style={{ ...S.mono, fontSize: 12, color: savingsRate >= 20 ? "#4ade80" : savingsRate >= 10 ? "#fbbf24" : "#f87171" }}>{savingsRate.toFixed(1)}%</div>
                </div>
                <div style={{ background: "#191d2e", borderRadius: 6, height: 8, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, savingsRate))}%`, background: savingsRate >= 20 ? "#4ade80" : savingsRate >= 10 ? "#fbbf24" : "#f87171", borderRadius: 6, transition: "width .5s ease" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, ...S.mono, fontSize: 9, color: "#3a3f5a" }}>
                  <span>0%</span><span style={{ color: "#fbbf24" }}>10% good</span><span style={{ color: "#4ade80" }}>20% great</span><span>100%</span>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={S.card}>
                  <div style={{ ...S.label, color: "#c4a24a", marginBottom: 16 }}>Upcoming (60 days)</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {upcoming.slice(0, 9).map((e, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: "#0e1019", borderRadius: 8, borderLeft: `3px solid ${CAT_COLORS[e.category] || "#4a4f6a"}` }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, marginBottom: 1 }}>{e.name}</div>
                          <div style={{ ...S.mono, fontSize: 9, color: "#3a3f5a" }}>{e.nextDue} · {daysLabel(e.nextDue)}</div>
                        </div>
                        <div style={{ ...S.mono, fontSize: 13, color: e.type === "income" ? "#4ade80" : "#f87171", marginLeft: 12 }}>
                          {e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}
                        </div>
                      </div>
                    ))}
                    {upcoming.length === 0 && <div style={{ color: "#3a3f5a", fontSize: 13, padding: 20, textAlign: "center" }}>No upcoming payments</div>}
                  </div>
                </div>

                <div style={S.card}>
                  <div style={{ ...S.label, color: "#c4a24a", marginBottom: 12 }}>Expense Breakdown / Month</div>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={catData} cx="50%" cy="50%" innerRadius={44} outerRadius={68} dataKey="value" paddingAngle={2} strokeWidth={0}>
                        {catData.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => [fmt(v), "Monthly"]} contentStyle={{ background: "#12141e", border: "1px solid #252840", borderRadius: 8, ...S.mono, fontSize: 11, color: "#ddd8cc" }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {catData.slice(0, 6).map(c => (
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

          {/* ── PAYMENTS ── */}
          {tab === "payments" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  {[["all","All"],["income","Income"],["expense","Expenses"]].map(([v,l]) => (
                    <button key={v} onClick={() => setFilterType(v)} style={{
                      background: filterType === v ? "#c4a24a" : "#12141e", color: filterType === v ? "#0b0d14" : "#3a3f5a",
                      border: "1px solid " + (filterType === v ? "#c4a24a" : "#191d2e"),
                      borderRadius: 8, padding: "7px 16px", cursor: "pointer", ...S.mono, fontSize: 11, letterSpacing: 1,
                    }}>{l}</button>
                  ))}
                </div>
                <button onClick={openAdd} style={{ background: "#c4a24a", color: "#0b0d14", border: "none", borderRadius: 9, padding: "9px 20px", ...S.mono, fontSize: 11, cursor: "pointer", letterSpacing: 1, fontWeight: 600 }}>+ Add Entry</button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {listEntries.length === 0 && <div style={{ color: "#3a3f5a", textAlign: "center", padding: 40 }}>No entries yet — add one above</div>}
                {listEntries.map(e => (
                  <div key={e.id} style={{ background: "#12141e", border: "1px solid #191d2e", borderRadius: 11, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }}>
                      <div style={{ width: 4, height: 38, borderRadius: 3, background: CAT_COLORS[e.category] || "#4a4f6a", flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 15, marginBottom: 3 }}>{e.name}</div>
                        <div style={{ ...S.mono, fontSize: 9, color: "#3a3f5a" }}>{e.category} · {FREQ_LABELS[e.frequency]} · Next {e.nextDue}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ ...S.mono, fontSize: 16, color: e.type === "income" ? "#4ade80" : "#f87171" }}>{e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}</div>
                        <div style={{ ...S.mono, fontSize: 9, color: "#3a3f5a" }}>{fmt(toMonthly(e.amount, e.frequency))}/mo equiv</div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openEdit(e)} style={{ background: "#191d2e", border: "1px solid #252840", color: "#c4a24a", borderRadius: 7, padding: "6px 12px", cursor: "pointer", ...S.mono, fontSize: 10 }}>Edit</button>
                        <button onClick={() => deleteEntry(e.id)} style={{ background: "#191d2e", border: "1px solid #252840", color: "#f87171", borderRadius: 7, padding: "6px 12px", cursor: "pointer", ...S.mono, fontSize: 10 }}>×</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 20, background: "#12141e", border: "1px solid #191d2e", borderRadius: 11, padding: "14px 20px", display: "flex", justifyContent: "space-around" }}>
                {[
                  { label: "Total Income",   val: fmt(monthlyIncome)   + "/mo", color: "#4ade80" },
                  { label: "Total Expenses", val: fmt(monthlyExpenses) + "/mo", color: "#f87171" },
                  { label: "Net Position",   val: (monthlyNet >= 0 ? "+" : "–") + fmt(monthlyNet) + "/mo", color: monthlyNet >= 0 ? "#4ade80" : "#f87171" },
                ].map(c => (
                  <div key={c.label} style={{ textAlign: "center" }}>
                    <div style={{ ...S.mono, fontSize: 9, color: "#3a3f5a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>{c.label}</div>
                    <div style={{ ...S.mono, fontSize: 15, color: c.color }}>{c.val}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── CASH FLOW ── */}
          {tab === "cashflow" && (
            <div>
              <div style={{ ...S.mono, fontSize: 9, letterSpacing: 2.5, color: "#c4a24a", textTransform: "uppercase", marginBottom: 20 }}>Cash Flow · Next 90 Days</div>
              {Object.entries(cfMonths).map(([monthKey, evts]) => {
                const mIncome   = evts.filter(e => e.type === "income").reduce((s,e) => s + e.amount, 0);
                const mExpenses = evts.filter(e => e.type === "expense").reduce((s,e) => s + e.amount, 0);
                const mNet      = mIncome - mExpenses;
                const monthLabel = new Date(monthKey + "-01").toLocaleDateString("en-AU", { month: "long", year: "numeric" });
                return (
                  <div key={monthKey} style={{ ...S.card, marginBottom: 16, borderRadius: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <div style={{ ...S.mono, fontSize: 12 }}>{monthLabel}</div>
                      <div style={{ display: "flex", gap: 16 }}>
                        {mIncome   > 0 && <span style={{ ...S.mono, fontSize: 11, color: "#4ade80" }}>+{fmt(mIncome)}</span>}
                        {mExpenses > 0 && <span style={{ ...S.mono, fontSize: 11, color: "#f87171" }}>–{fmt(mExpenses)}</span>}
                        <span style={{ ...S.mono, fontSize: 11, color: mNet >= 0 ? "#4ade80" : "#f87171", borderLeft: "1px solid #252840", paddingLeft: 14 }}>{mNet >= 0 ? "+" : "–"}{fmt(mNet)} net</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {evts.map((e, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#0e1019", borderRadius: 7 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 7, height: 7, borderRadius: "50%", background: CAT_COLORS[e.category] || "#4a4f6a", flexShrink: 0 }} />
                            <span style={{ fontSize: 14 }}>{e.name}</span>
                            <span style={{ ...S.mono, fontSize: 9, color: "#3a3f5a" }}>{e.dueStr}</span>
                            <span style={{ ...S.mono, fontSize: 9, color: "#252840", background: "#191d2e", borderRadius: 4, padding: "2px 6px" }}>{FREQ_LABELS[e.frequency]}</span>
                          </div>
                          <span style={{ ...S.mono, fontSize: 13, color: e.type === "income" ? "#4ade80" : "#f87171" }}>{e.type === "income" ? "+" : "–"}{fmtFull(e.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {cfEvents.length === 0 && <div style={{ color: "#3a3f5a", textAlign: "center", padding: 40 }}>No upcoming cash flows</div>}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL ── */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(5,6,12,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
          <div style={{ background: "#12141e", border: "1px solid #252840", borderRadius: 16, padding: "28px 30px", width: "100%", maxWidth: 460 }}>
            <div style={{ ...S.mono, fontSize: 9, letterSpacing: 3, color: "#c4a24a", textTransform: "uppercase", marginBottom: 22 }}>
              {modal === "add" ? "Add New Entry" : "Edit Entry"}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={S.label}>Name</div>
                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Netflix, Rent, Salary…" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={S.label}>Type</div>
                  <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value, category: e.target.value === "income" ? "Salary" : "Housing"}))}>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div>
                  <div style={S.label}>Amount ($)</div>
                  <input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({...f, amount: e.target.value}))} placeholder="0.00" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={S.label}>Frequency</div>
                  <select value={form.frequency} onChange={e => setForm(f => ({...f, frequency: e.target.value}))}>
                    {FREQUENCIES.map(f => <option key={f} value={f}>{FREQ_LABELS[f]}</option>)}
                  </select>
                </div>
                <div>
                  <div style={S.label}>Category</div>
                  <select value={form.category} onChange={e => setForm(f => ({...f, category: e.target.value}))}>
                    {(CATEGORIES[form.type] || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div style={S.label}>Next Due Date</div>
                <input type="date" value={form.nextDue} onChange={e => setForm(f => ({...f, nextDue: e.target.value}))} />
              </div>
              {form.amount && (
                <div style={{ background: "#0e1019", borderRadius: 9, padding: "12px 14px", ...S.mono, fontSize: 11, color: "#3a3f5a" }}>
                  <span style={{ color: "#ddd8cc" }}>{fmtFull(parseFloat(form.amount)||0)} {FREQ_LABELS[form.frequency]}</span>
                  {" = "}
                  <span style={{ color: form.type === "income" ? "#4ade80" : "#f87171" }}>{fmt(toMonthly(parseFloat(form.amount)||0, form.frequency))}/mo</span>
                  {" · "}
                  <span style={{ color: "#c4a24a" }}>{fmt(toMonthly(parseFloat(form.amount)||0, form.frequency)*12)}/yr</span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
              <button onClick={() => setModal(null)} style={{ flex: 1, background: "#191d2e", border: "1px solid #252840", color: "#7a8299", borderRadius: 9, padding: "12px", ...S.mono, fontSize: 11, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveEntry} style={{ flex: 2, background: "#c4a24a", border: "none", color: "#0b0d14", borderRadius: 9, padding: "12px", ...S.mono, fontSize: 11, cursor: "pointer", fontWeight: 700, letterSpacing: 1 }}>Save Entry</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
