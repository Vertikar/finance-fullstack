import { useState, useEffect, useRef } from "react";
import { THEMES } from "./themes";
import { api } from "./api";
import { CATEGORIES, CAT_COLORS, toMonthly, totalMonthlyBudgets, fmt } from "./utils";

/**
 * Budget tab — set a planned monthly allowance per expense category for
 * variable spending (Petrol, Groceries, …) that isn't tracked as fixed
 * recurring entries. Allowances are folded into the dashboard's monthly
 * totals so the "leftover" figure reflects them.
 *
 * `budgets` / `setBudgets` are owned by the parent (App) so edits here update
 * the Overview totals immediately.
 */
export default function Budget({ entries = [], budgets = [], setBudgets, T, isMobile, setApiError }) {
  const theme  = T        ?? THEMES["dark"];
  const mobile = isMobile ?? false;

  // Local input drafts keyed by category, seeded from the saved budgets.
  const [drafts, setDrafts] = useState({});
  const focusedRef = useRef(null);

  // Sync drafts when budgets load/change, but never clobber the field the
  // user is currently editing.
  useEffect(() => {
    setDrafts(prev => {
      const next = { ...prev };
      for (const b of budgets) {
        if (b.category !== focusedRef.current) {
          next[b.category] = String(b.amount);
        }
      }
      return next;
    });
  }, [budgets]);

  const byCategory = {};
  for (const b of budgets) byCategory[b.category] = b;

  async function commit(category) {
    const raw = drafts[category];
    const value = parseFloat(raw);
    const existing = byCategory[category];
    setApiError?.("");

    try {
      if (!raw || isNaN(value) || value <= 0) {
        // Cleared / zeroed — remove any existing allowance.
        if (existing) {
          await api.deleteBudget(existing.id);
          setBudgets(prev => prev.filter(b => b.id !== existing.id));
        }
        setDrafts(d => ({ ...d, [category]: "" }));
        return;
      }
      if (existing) {
        const updated = await api.updateBudget(existing.id, { amount: value });
        setBudgets(prev => prev.map(b => (b.id === updated.id ? updated : b)));
      } else {
        const created = await api.createBudget({ category, amount: value });
        setBudgets(prev => [...prev, created]);
      }
    } catch (e) {
      setApiError?.(e.message);
    }
  }

  const monthlyIncome   = entries.filter(e => e.type === "income")
    .reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const monthlyFixed    = entries.filter(e => e.type === "expense")
    .reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const monthlyBudgets  = totalMonthlyBudgets(budgets);
  const leftover        = monthlyIncome - monthlyFixed - monthlyBudgets;

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

  const summary = [
    { label: "Monthly Income",   val: fmt(monthlyIncome),   color: theme.income },
    { label: "Fixed Expenses",   val: fmt(monthlyFixed),    color: theme.expense },
    { label: "Variable Budgets", val: fmt(monthlyBudgets),  color: theme.expense },
    {
      label: "Leftover / Month",
      val: (leftover >= 0 ? "+" : "–") + fmt(leftover),
      color: leftover >= 0 ? theme.income : theme.expense,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: mobile ? 12 : 20 }}>

      {/* Header */}
      <div style={{ ...S.mono, fontSize: 9, letterSpacing: 3, color: theme.accent, textTransform: "uppercase" }}>
        Budget · Monthly Allowances
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: mobile ? 10 : 14 }}>
        {summary.map(c => (
          <div key={c.label} style={S.card}>
            <span style={S.label}>{c.label}</span>
            <div style={{ ...S.mono, fontSize: mobile ? 15 : 20, fontWeight: 500, color: c.color }}>{c.val}</div>
          </div>
        ))}
      </div>

      {/* Per-category allowances */}
      <div style={S.card}>
        <span style={{ ...S.label, color: theme.accent }}>Allowance Per Category</span>
        <div style={{ ...S.mono, fontSize: 10, color: theme.textMuted, marginBottom: 14, letterSpacing: 0.5, textTransform: "none" }}>
          Set a planned monthly amount for variable spending. Leave blank for categories you don't budget.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {CATEGORIES.expense.map(cat => (
            <div key={cat} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "9px 12px", background: theme.bgInner, borderRadius: 8,
              borderLeft: `3px solid ${CAT_COLORS[cat] || "#4a4f6a"}`,
            }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: theme.text }}>{cat}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, width: mobile ? 120 : 150 }}>
                <span style={{ ...S.mono, fontSize: 12, color: theme.textMuted }}>$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  aria-label={`${cat} monthly budget`}
                  placeholder="0"
                  value={drafts[cat] ?? ""}
                  onFocus={() => { focusedRef.current = cat; }}
                  onChange={e => setDrafts(d => ({ ...d, [cat]: e.target.value }))}
                  onBlur={() => { focusedRef.current = null; commit(cat); }}
                />
                <span style={{ ...S.mono, fontSize: 10, color: theme.textMuted }}>/mo</span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
