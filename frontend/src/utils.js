export const FREQUENCIES = ["weekly", "fortnightly", "monthly", "quarterly", "biannual", "yearly"];

export const FREQ_LABELS = {
  weekly:      "Weekly",
  fortnightly: "Fortnightly",
  monthly:     "Monthly",
  quarterly:   "Quarterly",
  biannual:    "Biannual",
  yearly:      "Yearly",
};

export const CATEGORIES = {
  income:  ["Salary", "Freelance", "Investment", "Rental", "Government", "Other Income"],
  expense: ["Housing", "Transport", "Food & Groceries", "Utilities", "Insurance",
            "Health", "Entertainment", "Subscriptions", "Education", "Savings", "Clothing", "Other"],
};

export const CAT_COLORS = {
  "Salary": "#4ade80", "Freelance": "#34d399", "Investment": "#6ee7b7",
  "Rental": "#a7f3d0", "Government": "#86efac", "Other Income": "#d1fae5",
  "Housing": "#f87171", "Transport": "#fb923c", "Food & Groceries": "#fbbf24",
  "Utilities": "#a78bfa", "Insurance": "#60a5fa", "Health": "#f472b6",
  "Entertainment": "#c084fc", "Subscriptions": "#22d3ee", "Education": "#818cf8",
  "Savings": "#4ade80", "Clothing": "#f9a8d4", "Other": "#94a3b8",
};

/**
 * Convert a payment amount to its monthly equivalent.
 * biannual = every 6 months = 2 payments/year → amount / 6
 */
export function toMonthly(amount, freq) {
  const multipliers = {
    weekly:      52 / 12,
    fortnightly: 26 / 12,
    monthly:     1,
    quarterly:   1 / 3,
    biannual:    1 / 6,
    yearly:      1 / 12,
  };
  return amount * (multipliers[freq] ?? 1);
}

/**
 * Advance a date by one payment period.
 */
export function addFreq(date, freq) {
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

/** Format a number as AUD currency (no decimals). */
export const fmt = (n) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD", maximumFractionDigits: 0,
  }).format(Math.abs(n));

/** Format a number as AUD currency (2 decimal places). */
export const fmtFull = (n) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "AUD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Math.abs(n));

/** Compute savings rate as a percentage. */
export function savingsRate(monthlyIncome, monthlyExpenses) {
  if (monthlyIncome <= 0) return 0;
  return ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100;
}

/**
 * Build cash-flow events for the next N days from a list of entries.
 */
export function buildCashFlow(entries, today, days = 90) {
  const end = new Date(today);
  end.setDate(end.getDate() + days);

  const events = [];
  for (const entry of entries) {
    let d = new Date(entry.nextDue);
    while (d < today) d = addFreq(d, entry.frequency);
    while (d < end) {
      events.push({
        ...entry,
        dueDate: new Date(d),
        dueStr:  d.toISOString().split("T")[0],
      });
      d = addFreq(d, entry.frequency);
    }
  }
  return events.sort((a, b) => a.dueDate - b.dueDate);
}
