import { useState, useEffect, useMemo } from "react";
import { THEMES } from "./themes";
import { api } from "./api";

const CAT_COLORS = {
  Salary: "#4ade80", Freelance: "#34d399", Investment: "#6ee7b7",
  Rental: "#a7f3d0", Government: "#86efac", "Other Income": "#d1fae5",
  Housing: "#f87171", Transport: "#fb923c", "Food & Groceries": "#fbbf24",
  Utilities: "#a78bfa", Insurance: "#60a5fa", Health: "#f472b6",
  Entertainment: "#c084fc", Subscriptions: "#22d3ee", Education: "#818cf8",
  Savings: "#4ade80", Clothing: "#f9a8d4", Other: "#94a3b8",
};

const ANNUAL_MULT = {
  weekly: 52, fortnightly: 26, monthly: 12,
  quarterly: 4, biannual: 2, yearly: 1,
};

function toCycle(amount, freq, cyclesPerYear) {
  return amount * (ANNUAL_MULT[freq] ?? 1) / cyclesPerYear;
}

function addFreq(date, freq) {
  const d = new Date(date);
  switch (freq) {
    case "weekly":      d.setDate(d.getDate() + 7);          break;
    case "fortnightly": d.setDate(d.getDate() + 14);         break;
    case "monthly":     d.setMonth(d.getMonth() + 1);        break;
    case "quarterly":   d.setMonth(d.getMonth() + 3);        break;
    case "biannual":    d.setMonth(d.getMonth() + 6);        break;
    case "yearly":      d.setFullYear(d.getFullYear() + 1);  break;
    default: break;
  }
  return d;
}

function prevFreq(date, freq) {
  const d = new Date(date);
  switch (freq) {
    case "weekly":      d.setDate(d.getDate() - 7);          break;
    case "fortnightly": d.setDate(d.getDate() - 14);         break;
    case "monthly":     d.setMonth(d.getMonth() - 1);        break;
    case "quarterly":   d.setMonth(d.getMonth() - 3);        break;
    case "biannual":    d.setMonth(d.getMonth() - 6);        break;
    case "yearly":      d.setFullYear(d.getFullYear() - 1);  break;
    default: break;
  }
  return d;
}

function getCurrentCycleWindow(lastPayDate, payCycle) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let start = new Date(lastPayDate + "T00:00:00");

  if (payCycle === "fortnightly") {
    while (start.getTime() + 14 * 86400000 <= today.getTime()) {
      start = new Date(start.getTime() + 14 * 86400000);
    }
    return { start, end: new Date(start.getTime() + 14 * 86400000) };
  } else {
    while (true) {
      const next = new Date(start);
      next.setMonth(next.getMonth() + 1);
      if (next > today) return { start, end: next };
      start = next;
    }
  }
}

function getExpensesDueInCycle(entries, cycleStart, cycleEnd) {
  const due = [];
  for (const e of entries) {
    if (e.type !== "expense") continue;
    let d = new Date(e.nextDue + "T00:00:00");
    while (d >= cycleEnd) d = prevFreq(d, e.frequency);
    while (d < cycleStart) d = addFreq(d, e.frequency);
    while (d < cycleEnd) {
      due.push({ ...e, dueInCycle: new Date(d), dueStr: d.toISOString().split("T")[0] });
      d = addFreq(d, e.frequency);
    }
  }
  return due.sort((a, b) => a.dueInCycle - b.dueInCycle);
}

const fmt     = n => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(Math.abs(n));
const fmtFull = n => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));

function dateLabel(d) {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export default function PayCycle({ entries, T, isMobile }) {
  const theme  = T      ?? THEMES["dark"];
  const mobile = isMobile ?? false;

  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settings, setSettings]               = useState(null);
  const [showConfig, setShowConfig]           = useState(false);
  const [saveError, setSaveError]             = useState("");
  const [formCycle, setFormCycle]             = useState("fortnightly");
  const [formDate,  setFormDate]              = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    api.getPayCycleSettings()
      .then(data => {
        if (data?.pay_cycle && data?.last_pay_date) {
          setSettings({ payCycle: data.pay_cycle, lastPayDate: data.last_pay_date });
          setFormCycle(data.pay_cycle);
          setFormDate(data.last_pay_date);
        } else {
          setShowConfig(true);
        }
      })
      .catch(() => setShowConfig(true))
      .finally(() => setLoadingSettings(false));
  }, []);

  async function saveSettings() {
    setSaveError("");
    try {
      const data = await api.savePayCycleSettings({
        pay_cycle: formCycle,
        last_pay_date: formDate,
      });
      setSettings({ payCycle: data.pay_cycle, lastPayDate: data.last_pay_date });
      setShowConfig(false);
    } catch (e) {
      setSaveError(e.message);
    }
  }

  const cyclesPerYear = settings?.payCycle === "monthly" ? 12 : 26;
  const cycleNoun     = settings?.payCycle === "monthly" ? "Month"      : "Fortnight";
  const cycleShort    = settings?.payCycle === "monthly" ? "mo"         : "fn";
  const cycleLabel    = settings?.payCycle === "monthly" ? "monthly"    : "fortnightly";

  const income   = entries.filter(e => e.type === "income");
  const expenses = entries.filter(e => e.type === "expense");

  const incomePerCycle   = income.reduce((s, e)   => s + toCycle(e.amount, e.frequency, cyclesPerYear), 0);
  const expensesPerCycle = expenses.reduce((s, e) => s + toCycle(e.amount, e.frequency, cyclesPerYear), 0);
  const netPerCycle      = incomePerCycle - expensesPerCycle;

  const cycleWindow = useMemo(() =>
    settings ? getCurrentCycleWindow(settings.lastPayDate, settings.payCycle) : null,
    [settings]
  );

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const daysInCycle   = cycleWindow ? Math.round((cycleWindow.end - cycleWindow.start) / 86400000) : 14;
  const daysElapsed   = cycleWindow ? Math.max(0, Math.round((today - cycleWindow.start) / 86400000)) : 0;
  const daysRemaining = daysInCycle - daysElapsed;

  const dueThisCycle = useMemo(() =>
    cycleWindow ? getExpensesDueInCycle(entries, cycleWindow.start, cycleWindow.end) : [],
    [entries, cycleWindow]
  );

  const catBreakdown = useMemo(() => {
    const cpy = settings?.payCycle === "monthly" ? 12 : 26;
    const totals = {};
    entries.filter(e => e.type === "expense").forEach(e => {
      totals[e.category] = (totals[e.category] || 0) + toCycle(e.amount, e.frequency, cpy);
    });
    const sorted = Object.entries(totals)
      .map(([cat, val]) => ({ cat, val }))
      .sort((a, b) => b.val - a.val);
    const max = sorted.length > 0 ? sorted[0].val : 1;
    return sorted.map(row => ({ ...row, pct: (row.val / max) * 100 }));
  }, [entries, settings]);

  const S = {
    card: {
      background: theme.bgCard,
      border: `1px solid ${theme.border}`,
      borderRadius: 12,
      padding: mobile ? "14px" : "18px 20px",
    },
    label: {
      fontFamily: "'DM Mono',monospace",
      fontSize: 9, letterSpacing: 2.5,
      color: theme.textMuted, textTransform: "uppercase",
      marginBottom: 10, display: "block",
    },
    mono: { fontFamily: "'DM Mono',monospace" },
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loadingSettings) {
    return (
      <div style={{ textAlign: "center", padding: 60, ...S.mono, fontSize: 11, color: theme.textMuted, letterSpacing: 2 }}>
        Loading…
      </div>
    );
  }

  // ── Config form ──────────────────────────────────────────────────────────────
  if (showConfig) {
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: mobile ? 0 : 20 }}>
        <div style={{ ...S.card, width: "100%", maxWidth: 440 }}>
          <div style={{ ...S.mono, fontSize: 9, letterSpacing: 3, color: theme.accent, textTransform: "uppercase", marginBottom: 20 }}>
            Configure Pay Cycle
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <span style={S.label}>Pay Cycle</span>
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  ["fortnightly", "Fortnightly", "26×/yr"],
                  ["monthly",     "Monthly",     "12×/yr"],
                ].map(([val, label, sub]) => (
                  <button key={val} onClick={() => setFormCycle(val)} style={{
                    flex: 1, padding: "11px 10px", borderRadius: 9, cursor: "pointer",
                    background: formCycle === val ? theme.accent + "1a" : theme.bgSubtle,
                    border: `1px solid ${formCycle === val ? theme.accent : theme.border2}`,
                    color: formCycle === val ? theme.accent : theme.textMid,
                    ...S.mono, fontSize: 11, letterSpacing: 1,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  }}>
                    <span style={{ fontWeight: 600 }}>{label}</span>
                    <span style={{ fontSize: 9, color: formCycle === val ? theme.accent + "aa" : theme.textMuted }}>{sub}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span style={S.label}>Most Recent Pay Date</span>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} />
            </div>
            {saveError && (
              <div style={{ ...S.mono, fontSize: 10, color: theme.expense, padding: "8px 12px", background: theme.errorBg, borderRadius: 7 }}>
                {saveError}
              </div>
            )}
            <button onClick={saveSettings} style={{
              background: theme.accent, color: theme.accentText, border: "none",
              borderRadius: 9, padding: "12px", cursor: "pointer", fontWeight: 700,
              letterSpacing: 1, ...S.mono, fontSize: 11,
            }}>Save &amp; Continue</button>
            {settings && (
              <button onClick={() => setShowConfig(false)} style={{
                background: theme.bgSubtle, border: `1px solid ${theme.border2}`,
                color: theme.textMid, borderRadius: 9, padding: "10px",
                cursor: "pointer", ...S.mono, fontSize: 11,
              }}>Cancel</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: mobile ? 12 : 20 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ ...S.mono, fontSize: 9, letterSpacing: 3, color: theme.accent, textTransform: "uppercase", marginBottom: 4 }}>
            Pay Cycle · {cycleLabel}
          </div>
          <div style={{ fontSize: mobile ? 14 : 16, color: theme.textMid }}>
            {cycleWindow && <>{dateLabel(cycleWindow.start)} — {dateLabel(cycleWindow.end)}</>}
            <span style={{ ...S.mono, fontSize: 10, color: theme.textMuted, marginLeft: 10 }}>
              {daysRemaining}d remaining
            </span>
          </div>
        </div>
        <button onClick={() => setShowConfig(true)} style={{
          background: theme.bgSubtle, border: `1px solid ${theme.border2}`,
          color: theme.textMid, borderRadius: 8, padding: "7px 14px",
          cursor: "pointer", ...S.mono, fontSize: 10, letterSpacing: 1,
        }}>Change</button>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(3,1fr)", gap: mobile ? 10 : 14 }}>
        {[
          {
            label: `Income / ${cycleNoun}`,
            val: fmt(incomePerCycle),
            sub: `${fmt(incomePerCycle * cyclesPerYear)}/yr`,
            color: theme.income,
          },
          {
            label: `Set Aside / ${cycleNoun}`,
            val: fmt(expensesPerCycle),
            sub: `${fmt(expensesPerCycle * cyclesPerYear)}/yr`,
            color: theme.expense,
          },
          {
            label: `Net / ${cycleNoun}`,
            val: (netPerCycle >= 0 ? "+" : "–") + fmt(netPerCycle),
            sub: `${fmt(netPerCycle * cyclesPerYear)}/yr`,
            color: netPerCycle >= 0 ? theme.income : theme.expense,
          },
        ].map(c => (
          <div key={c.label} style={S.card}>
            <span style={S.label}>{c.label}</span>
            <div style={{ ...S.mono, fontSize: mobile ? 15 : 20, fontWeight: 500, color: c.color, marginBottom: 4 }}>{c.val}</div>
            <div style={{ ...S.mono, fontSize: 9, color: theme.textVeryMuted }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Cycle progress */}
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={S.label}>Cycle Progress</span>
          <span style={{ ...S.mono, fontSize: 11, color: theme.textMid }}>
            Day {daysElapsed + 1} of {daysInCycle}
          </span>
        </div>
        <div style={{ background: theme.bgSubtle, borderRadius: 6, height: 6, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${Math.min(100, (daysElapsed / daysInCycle) * 100)}%`,
            background: theme.accent, borderRadius: 6, transition: "width .5s ease",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, ...S.mono, fontSize: 9, color: theme.textMuted }}>
          {cycleWindow && <><span>{dateLabel(cycleWindow.start)}</span><span>{dateLabel(cycleWindow.end)}</span></>}
        </div>
      </div>

      {/* Due this cycle */}
      <div style={S.card}>
        <span style={{ ...S.label, color: theme.accent }}>Due This {cycleNoun}</span>
        {dueThisCycle.length === 0 ? (
          <div style={{ color: theme.textMuted, fontSize: 13, textAlign: "center", padding: 16 }}>
            No expenses due this {cycleNoun.toLowerCase()}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dueThisCycle.map((e, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "9px 12px", background: theme.bgInner, borderRadius: 8,
                borderLeft: `3px solid ${CAT_COLORS[e.category] || "#4a4f6a"}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: theme.text, marginBottom: 4 }}>{e.name}</div>
                  <div style={{ ...S.mono, fontSize: 9, color: theme.textMuted }}>
                    {e.category} · {e.dueStr}
                  </div>
                </div>
                <div style={{ ...S.mono, fontSize: 13, color: theme.expense, marginLeft: 12, flexShrink: 0 }}>
                  –{fmtFull(e.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Category breakdown */}
      <div style={S.card}>
        <span style={{ ...S.label, color: theme.accent }}>Expense Breakdown / {cycleNoun}</span>
        {catBreakdown.length === 0 ? (
          <div style={{ color: theme.textMuted, fontSize: 13, textAlign: "center", padding: 16 }}>No expenses yet</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {catBreakdown.map(({ cat, val, pct }) => (
              <div key={cat}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: CAT_COLORS[cat] || "#94a3b8" }} />
                    <span style={{ ...S.mono, fontSize: 10, color: theme.textMid }}>{cat}</span>
                  </div>
                  <span style={{ ...S.mono, fontSize: 11, color: theme.text }}>{fmt(val)}</span>
                </div>
                <div style={{ background: theme.bgSubtle, borderRadius: 3, height: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: (CAT_COLORS[cat] || "#94a3b8") + "88", borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Full expense allocation table */}
      <div style={S.card}>
        <span style={{ ...S.label, color: theme.accent }}>All Expenses · Per {cycleNoun} Allocation</span>
        {expenses.length === 0 ? (
          <div style={{ color: theme.textMuted, fontSize: 13, textAlign: "center", padding: 16 }}>No expenses yet</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...expenses]
              .sort((a, b) => toCycle(b.amount, b.frequency, cyclesPerYear) - toCycle(a.amount, a.frequency, cyclesPerYear))
              .map(e => {
                const perCycle = toCycle(e.amount, e.frequency, cyclesPerYear);
                return (
                  <div key={e.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 10px", background: theme.bgInner, borderRadius: 7,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: CAT_COLORS[e.category] || "#4a4f6a", flexShrink: 0 }} />
                        <span style={{ fontSize: 14, color: theme.text }}>{e.name}</span>
                      </div>
                      <div style={{ ...S.mono, fontSize: 9, color: theme.textMuted }}>
                        {fmtFull(e.amount)} {e.frequency} · {e.category}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ ...S.mono, fontSize: 13, color: theme.expense }}>{fmt(perCycle)}</div>
                      <div style={{ ...S.mono, fontSize: 9, color: theme.textMuted }}>/{cycleShort}</div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

    </div>
  );
}
