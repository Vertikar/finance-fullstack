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

// Buckets are the higher-level grouping (income/living/lifestyle/goals) that
// entries inherit via their category. The authoritative mapping is DB-backed
// (GET /api/categories); this constant mirrors the seed for the 18 built-in
// categories so the bucket views still render when the fetch is unavailable.
export const CAT_BUCKETS = {
  "Salary": "income", "Freelance": "income", "Investment": "income",
  "Rental": "income", "Government": "income", "Other Income": "income",
  "Housing": "living", "Transport": "living", "Food & Groceries": "living",
  "Utilities": "living", "Insurance": "living", "Health": "living",
  "Education": "living", "Other": "living",
  "Entertainment": "lifestyle", "Subscriptions": "lifestyle", "Clothing": "lifestyle",
  "Savings": "goals",
};

// Display metadata for the four buckets — label, accent colour, and the order
// they appear in breakdowns and filters. Gold (#c4a24a) accents goals to match
// the dark-luxury palette; the rest use muted, distinct tones.
export const BUCKET_META = {
  income:    { label: "Income",    color: "#4ade80" },
  living:    { label: "Living",    color: "#60a5fa" },
  lifestyle: { label: "Lifestyle", color: "#c084fc" },
  goals:     { label: "Goals",     color: "#c4a24a" },
};
export const BUCKET_ORDER = ["living", "lifestyle", "goals", "income"];

/**
 * Resolve an entry's effective bucket. An entry's own `bucket` is an optional
 * override; when absent it inherits its category's bucket from `catBucketMap`
 * (name → bucket, built from the fetched categories), falling back to "living".
 */
export function entryBucket(entry, catBucketMap = {}) {
  return entry.bucket || catBucketMap[entry.category] || "living";
}

// Column names that only appear in raw bank-statement exports, never in a
// recurring-entries CSV. Used to tell the two apart on a failed import.
export const STATEMENT_SIGNAL_COLS = [
  "transaction_date", "budget_category", "transaction_type",
  "debit", "credit", "balance", "account_name", "provider_name",
];

/**
 * Guess whether a CSV's headers came from a bank statement rather than a
 * recurring-entries file.
 *
 * Two signals are required, not one: an entries CSV could plausibly carry a
 * stray `balance` or `account_name` column of its own, and a false positive
 * would send someone down the wrong path. Bank exports carry several.
 */
export function looksLikeBankStatement(headers = []) {
  const seen = new Set(
    (headers || []).map(h => String(h).toLowerCase().trim())
  );
  const hits = STATEMENT_SIGNAL_COLS.filter(c => seen.has(c));
  return hits.length >= 2;
}

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

/** Last calendar day (28-31) of the month containing (year, monthIndex). */
function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Parse a "YYYY-MM-DD" date string as LOCAL midnight (avoids UTC day-shift). */
export function parseLocal(str) {
  return new Date(str + "T00:00:00");
}

/** Format a Date as a local "YYYY-MM-DD" string (avoids toISOString UTC shift). */
export function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Number of months to advance for each month-based frequency. Day-based
 * frequencies (weekly/fortnightly) are absent and handled separately.
 */
const MONTH_STEP = { monthly: 1, quarterly: 3, biannual: 6, yearly: 12 };

/**
 * Shift `date` by `months` calendar months, landing on `anchorDay` clamped to
 * the target month's length. Building the Date via the constructor avoids the
 * transient "Feb 31" → Mar 3 normalization that plain setMonth() suffers from,
 * and using the original anchorDay prevents end-of-month drift across short
 * months (Jan 31 → Feb 28 → Mar 31, not → Mar 28).
 */
function shiftMonths(date, months, anchorDay) {
  const targetYear  = date.getFullYear();
  const targetMonth = date.getMonth() + months;
  // Normalize month/year so lastDayOfMonth gets the real target month.
  const ref   = new Date(targetYear, targetMonth, 1);
  const day   = Math.min(anchorDay, lastDayOfMonth(ref.getFullYear(), ref.getMonth()));
  return new Date(ref.getFullYear(), ref.getMonth(), day);
}

/**
 * Sum a list of monthly budget allowances. Tolerates missing/undefined input
 * and string amounts (as returned from form inputs or JSON).
 */
export function totalMonthlyBudgets(budgets) {
  return (budgets || []).reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
}

/**
 * Advance a date by one payment period.
 *
 * `anchorDay` is the original due day-of-month; pass it when stepping
 * iteratively so end-of-month dates don't drift (see shiftMonths). When
 * omitted it defaults to the given date's day, preserving legacy behavior.
 */
export function addFreq(date, freq, anchorDay) {
  const d = new Date(date);
  const anchor = anchorDay ?? d.getDate();
  switch (freq) {
    case "weekly":      d.setDate(d.getDate() + 7);  break;
    case "fortnightly": d.setDate(d.getDate() + 14); break;
    case "monthly":
    case "quarterly":
    case "biannual":
    case "yearly":      return shiftMonths(d, MONTH_STEP[freq], anchor);
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
 * Reverse a date by one payment period (inverse of addFreq). Accepts the same
 * optional `anchorDay` so backward stepping clamps end-of-month dates the same
 * way forward stepping does.
 */
export function prevFreq(date, freq, anchorDay) {
  const d = new Date(date);
  const anchor = anchorDay ?? d.getDate();
  switch (freq) {
    case "weekly":      d.setDate(d.getDate() - 7);  break;
    case "fortnightly": d.setDate(d.getDate() - 14); break;
    case "monthly":
    case "quarterly":
    case "biannual":
    case "yearly":      return shiftMonths(d, -MONTH_STEP[freq], anchor);
    default: break;
  }
  return d;
}

/**
 * Given the user's most recent pay date and pay cycle, return the [start, end)
 * window for the current pay cycle. Accepts an optional `today` for testing.
 */
export function getCurrentCycleWindow(lastPayDate, payCycle, today = new Date()) {
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  let start = new Date(lastPayDate + "T00:00:00");

  if (payCycle === "fortnightly") {
    while (start.getTime() + 14 * 86400000 <= t.getTime()) {
      start = new Date(start.getTime() + 14 * 86400000);
    }
    return { start, end: new Date(start.getTime() + 14 * 86400000) };
  } else {
    // NOTE: this monthly branch uses plain setMonth() and shares the
    // end-of-month overflow bug fixed in addFreq/shiftMonths — a pay date on
    // the 31st can produce a malformed cycle window. Left as-is (out of scope).
    while (true) {
      const next = new Date(start);
      next.setMonth(next.getMonth() + 1);
      if (next > t) return { start, end: next };
      start = next;
    }
  }
}

/**
 * Yield every occurrence of `entry` falling within the half-open window
 * [start, end). Anchored on the entry's original nextDue day-of-month so
 * end-of-month dates don't drift across short months. Returns occurrence Dates.
 */
function occurrencesInWindow(entry, start, end) {
  const occ = [];
  const first = parseLocal(entry.nextDue);
  const anchorDay = first.getDate();
  let d = first;
  while (d >= end)   d = prevFreq(d, entry.frequency, anchorDay);
  while (d < start)  d = addFreq(d, entry.frequency, anchorDay);
  while (d < end) {
    occ.push(new Date(d));
    d = addFreq(d, entry.frequency, anchorDay);
  }
  return occ;
}

/**
 * Return all expense entries (and their specific occurrence dates) that fall
 * within the half-open window [cycleStart, cycleEnd).
 */
export function getExpensesDueInCycle(entries, cycleStart, cycleEnd) {
  const due = [];
  for (const e of entries) {
    if (e.type !== "expense") continue;
    for (const d of occurrencesInWindow(e, cycleStart, cycleEnd)) {
      due.push({ ...e, dueInCycle: d, dueStr: toDateStr(d) });
    }
  }
  return due.sort((a, b) => a.dueInCycle - b.dueInCycle);
}

/**
 * Build cash-flow events for the next N days from a list of entries.
 * Half-open window: [today, today + days).
 */
export function buildCashFlow(entries, today, days = 90) {
  const end = new Date(today);
  end.setDate(end.getDate() + days);

  const events = [];
  for (const entry of entries) {
    for (const d of occurrencesInWindow(entry, today, end)) {
      events.push({
        ...entry,
        dueDate: d,
        dueStr:  toDateStr(d),
      });
    }
  }
  return events.sort((a, b) => a.dueDate - b.dueDate);
}

/**
 * Sum the ACTUAL income and expense amounts that fall within the calendar month
 * containing `today`. Unlike toMonthly (which uses averaged multipliers), this
 * counts real occurrences — so a month with 3 fortnightly or 5 weekly payments
 * reports the true higher total. Returns { income, expenses, net }.
 */
export function sumActualForMonth(entries, today = new Date()) {
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  let income = 0, expenses = 0;
  for (const e of entries) {
    const total = occurrencesInWindow(e, monthStart, monthEnd).length * e.amount;
    if (e.type === "income") income += total;
    else                     expenses += total;
  }
  return { income, expenses, net: income - expenses };
}
