import { toMonthly, addFreq, fmt, fmtFull, savingsRate, buildCashFlow,
         prevFreq, getCurrentCycleWindow, getExpensesDueInCycle,
         sumActualForMonth, totalMonthlyBudgets, entryBucket,
         looksLikeBankStatement } from './utils';

// ─── looksLikeBankStatement ────────────────────────────────────────────────────

describe('looksLikeBankStatement', () => {
  test('recognises a Frollo export header row', () =>
    expect(looksLikeBankStatement([
      'transaction_id', 'transaction_date', 'description', 'amount',
      'category_name', 'budget_category', 'transaction_type', 'included',
    ])).toBe(true));

  test('recognises a debit/credit style statement', () =>
    expect(looksLikeBankStatement(['date', 'description', 'debit', 'credit', 'balance'])).toBe(true));

  test('rejects the entries import template', () =>
    expect(looksLikeBankStatement(
      ['name', 'amount', 'type', 'frequency', 'category', 'next_due']
    )).toBe(false));

  // One stray signal column is not enough — an entries CSV could carry its own
  // `balance` column without being a statement.
  test('rejects a single incidental signal column', () =>
    expect(looksLikeBankStatement(['name', 'amount', 'balance'])).toBe(false));

  test('tolerates case and padding', () =>
    expect(looksLikeBankStatement([' Transaction_Date ', 'BUDGET_CATEGORY'])).toBe(true));

  test('handles empty and missing input', () => {
    expect(looksLikeBankStatement([])).toBe(false);
    expect(looksLikeBankStatement()).toBe(false);
  });
});

// ─── entryBucket ───────────────────────────────────────────────────────────────

describe('entryBucket', () => {
  const catMap = { Housing: 'living', Restaurants: 'lifestyle' };
  test('override wins over category default', () =>
    expect(entryBucket({ category: 'Housing', bucket: 'goals' }, catMap)).toBe('goals'));
  test('inherits category bucket when no override', () =>
    expect(entryBucket({ category: 'Restaurants' }, catMap)).toBe('lifestyle'));
  test('empty-string override inherits from category', () =>
    expect(entryBucket({ category: 'Housing', bucket: '' }, catMap)).toBe('living'));
  test('falls back to living for unknown category', () =>
    expect(entryBucket({ category: 'Nonexistent' }, catMap)).toBe('living'));
});

// ─── totalMonthlyBudgets ───────────────────────────────────────────────────────

describe('totalMonthlyBudgets', () => {
  test('sums budget amounts',          () => expect(totalMonthlyBudgets([{ amount: 600 }, { amount: 250 }])).toBe(850));
  test('empty array returns 0',        () => expect(totalMonthlyBudgets([])).toBe(0));
  test('undefined input returns 0',    () => expect(totalMonthlyBudgets(undefined)).toBe(0));
  test('coerces string amounts',       () => expect(totalMonthlyBudgets([{ amount: '600' }, { amount: '50.5' }])).toBeCloseTo(650.5));
  test('ignores non-numeric amounts',  () => expect(totalMonthlyBudgets([{ amount: 'abc' }, { amount: 100 }])).toBe(100));
});

// ─── toMonthly ───────────────────────────────────────────────────────────────

describe('toMonthly', () => {
  test('monthly amount is unchanged',                  () => expect(toMonthly(1000,  'monthly')).toBeCloseTo(1000));
  test('weekly: multiplied by 52/12',                  () => expect(toMonthly(100,   'weekly')).toBeCloseTo(100 * 52 / 12));
  test('fortnightly: multiplied by 26/12',             () => expect(toMonthly(200,   'fortnightly')).toBeCloseTo(200 * 26 / 12));
  test('quarterly: divided by 3',                      () => expect(toMonthly(300,   'quarterly')).toBeCloseTo(100));
  test('biannual: divided by 6',                       () => expect(toMonthly(600,   'biannual')).toBeCloseTo(100));
  test('yearly: divided by 12',                        () => expect(toMonthly(1200,  'yearly')).toBeCloseTo(100));
  test('unknown frequency defaults to multiplier 1',   () => expect(toMonthly(500,   'unknown')).toBeCloseTo(500));
  test('zero amount returns zero',                     () => expect(toMonthly(0,     'monthly')).toBe(0));
});

// ─── addFreq ─────────────────────────────────────────────────────────────────

describe('addFreq', () => {
  const base = new Date('2026-01-01');

  test('weekly adds 7 days',            () => expect(addFreq(base, 'weekly').toISOString().split('T')[0]).toBe('2026-01-08'));
  test('fortnightly adds 14 days',      () => expect(addFreq(base, 'fortnightly').toISOString().split('T')[0]).toBe('2026-01-15'));
  test('monthly advances by 1 month',   () => expect(addFreq(base, 'monthly').toISOString().split('T')[0]).toBe('2026-02-01'));
  test('quarterly advances by 3 months',() => expect(addFreq(base, 'quarterly').toISOString().split('T')[0]).toBe('2026-04-01'));
  test('biannual advances by 6 months', () => expect(addFreq(base, 'biannual').toISOString().split('T')[0]).toBe('2026-07-01'));
  test('yearly advances by 1 year',     () => expect(addFreq(base, 'yearly').toISOString().split('T')[0]).toBe('2027-01-01'));

  test('does not mutate the original date', () => {
    const original = new Date('2026-06-15');
    addFreq(original, 'biannual');
    expect(original.toISOString().split('T')[0]).toBe('2026-06-15');
  });

  // ── End-of-month anchoring (regression for the setMonth overflow bug) ──
  // A bill due on the 31st must NOT skip short months or drift; each occurrence
  // is the original day clamped to the target month's length.
  describe('end-of-month does not overflow or drift', () => {
    const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    test('Jan 31 monthly steps land on month-ends, anchored to the 31st', () => {
      const anchor = 31;
      let d = new Date(2026, 0, 31); // Jan 31 2026
      const seq = [ymd(d)];
      for (let i = 0; i < 4; i++) { d = addFreq(d, 'monthly', anchor); seq.push(ymd(d)); }
      expect(seq).toEqual([
        '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
      ]);
    });

    test('without an explicit anchor a single step still clamps (no Mar 3)', () => {
      const r = addFreq(new Date(2026, 0, 31), 'monthly'); // Jan 31 → Feb (clamped)
      expect(r.getMonth()).toBe(1);   // February, not March
      expect(r.getDate()).toBe(28);
    });

    test('Jan 31 monthly into a leap February clamps to the 29th', () => {
      const r = addFreq(new Date(2024, 0, 31), 'monthly', 31); // 2024 is a leap year
      expect(ymd(r)).toBe('2024-02-29');
    });

    test('quarterly Nov 30 → Feb 28 (no overflow)', () => {
      const r = addFreq(new Date(2025, 10, 30), 'quarterly', 30); // Nov 30 2025 + 3mo
      expect(ymd(r)).toBe('2026-02-28');
    });

    test('biannual Aug 31 → Feb 28 (no overflow)', () => {
      const r = addFreq(new Date(2025, 7, 31), 'biannual', 31); // Aug 31 2025 + 6mo
      expect(ymd(r)).toBe('2026-02-28');
    });

    test('yearly Feb 29 clamps to Feb 28 in non-leap years and restores in the next leap year', () => {
      const anchor = 29;
      let d = new Date(2024, 1, 29); // Feb 29 2024
      const seq = [ymd(d)];
      for (let i = 0; i < 4; i++) { d = addFreq(d, 'yearly', anchor); seq.push(ymd(d)); }
      expect(seq).toEqual([
        '2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29',
      ]);
      // Never drifts into March
      seq.forEach(s => expect(s.slice(5, 7)).toBe('02'));
    });
  });
});

// ─── fmt / fmtFull ───────────────────────────────────────────────────────────

describe('fmt', () => {
  test('formats positive number as AUD, no decimals', () => expect(fmt(1234)).toMatch(/\$1,234/));
  test('treats negative as absolute',                 () => expect(fmt(-500)).toMatch(/\$500/));
  test('rounds to whole dollars',                     () => expect(fmt(99.9)).toMatch(/\$100/));
});

describe('fmtFull', () => {
  test('formats with 2 decimal places', () => expect(fmtFull(9.5)).toMatch(/\$9\.50/));
  test('treats negative as absolute',   () => expect(fmtFull(-100)).toMatch(/\$100\.00/));
});

// ─── savingsRate ──────────────────────────────────────────────────────────────

describe('savingsRate', () => {
  test('returns 0 when income is zero',             () => expect(savingsRate(0,    500)).toBe(0));
  test('returns 0 when income is negative',         () => expect(savingsRate(-100,   0)).toBe(0));
  test('correct rate with surplus',                 () => expect(savingsRate(4000, 3000)).toBeCloseTo(25));
  test('negative rate when expenses exceed income', () => expect(savingsRate(1000, 1500)).toBeCloseTo(-50));
  test('100% when expenses are zero',               () => expect(savingsRate(2000,    0)).toBeCloseTo(100));
});

// ─── buildCashFlow ────────────────────────────────────────────────────────────
//
// buildCashFlow uses a half-open window [today, today+days):
//   - Events on `today` ARE included  (d >= today after the advance loop)
//   - Events on `today+days` are NOT  (loop condition is d < end, strictly less)
//
// Important: nextDue strings are now parsed as LOCAL midnight (parseLocal), so
// anchor `today` with the local-midnight constructor new Date(y, m, d) to match.

describe('buildCashFlow', () => {
  const today = new Date(2026, 5, 1); // June 1 2026, local midnight

  const entries = [
    { id: '1', name: 'Rent',   amount: 1800, type: 'expense', frequency: 'monthly',
      category: 'Housing', nextDue: '2026-06-01' },
    { id: '2', name: 'Salary', amount: 5000, type: 'income',  frequency: 'monthly',
      category: 'Salary',  nextDue: '2026-06-15' },
  ];

  test('returns events sorted by date', () => {
    const events = buildCashFlow(entries, today, 90);
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++)
      expect(events[i].dueDate.getTime()).toBeGreaterThanOrEqual(events[i-1].dueDate.getTime());
  });

  test('monthly entry appears 3 times over 90 days', () => {
    const events = buildCashFlow(entries, today, 90);
    expect(events.filter(e => e.id === '1')).toHaveLength(3);
  });

  test('biannual entry appears once over 90 days', () => {
    const biannual = [{ id: '3', name: 'Car Rego', amount: 900, type: 'expense',
      frequency: 'biannual', category: 'Transport', nextDue: '2026-06-01' }];
    // Window [Jun 1, Aug 30) — only Jun 1 falls inside
    expect(buildCashFlow(biannual, today, 90)).toHaveLength(1);
  });

  test('biannual entry appears twice over 365 days', () => {
    const biannual = [{ id: '3', name: 'Car Rego', amount: 900, type: 'expense',
      frequency: 'biannual', category: 'Transport', nextDue: '2026-06-01' }];
    // Window [Jun 1 2026, Jun 1 2027) — Jun 1 2027 is the exclusive end,
    // so only Jun 1 2026 and Dec 1 2026 are included → 2 events
    expect(buildCashFlow(biannual, today, 365)).toHaveLength(2);
  });

  // With days=0: end = today, window is [today, today) = empty set → 0 events always
  test('0-day window returns no events', () => {
    const entry = [{ id: '4', name: 'Any', amount: 100, type: 'expense',
      frequency: 'monthly', category: 'Utilities', nextDue: '2026-06-01' }];
    expect(buildCashFlow(entry, today, 0)).toHaveLength(0);
  });

  // Use a 1-day window to confirm today's events ARE included
  test('1-day window includes events due today but not tomorrow', () => {
    const dueToday    = [{ id: '5', name: 'Due Today',    amount: 100, type: 'expense',
      frequency: 'monthly', category: 'Utilities', nextDue: '2026-06-01' }];
    const dueTomorrow = [{ id: '6', name: 'Due Tomorrow', amount: 100, type: 'expense',
      frequency: 'monthly', category: 'Utilities', nextDue: '2026-06-02' }];
    expect(buildCashFlow(dueToday,    today, 1)).toHaveLength(1); // Jun 1 in [Jun 1, Jun 2) ✓
    expect(buildCashFlow(dueTomorrow, today, 1)).toHaveLength(0); // Jun 2 not in [Jun 1, Jun 2) ✗
  });

  test('events have YYYY-MM-DD dueStr', () => {
    buildCashFlow(entries, today, 90).forEach(e =>
      expect(e.dueStr).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });

  test('past nextDue is advanced into the window before counting', () => {
    const past = [{ id: '7', name: 'Old Bill', amount: 100, type: 'expense',
      frequency: 'monthly', category: 'Utilities', nextDue: '2026-01-01' }];
    buildCashFlow(past, today, 60).forEach(e =>
      expect(new Date(e.dueStr).getTime()).toBeGreaterThanOrEqual(
        new Date('2026-06-01').getTime()
      ));
  });

  // The "heavy month" case: July 2026 spans 5 weeks, so a fortnightly bill due
  // Jul 3 falls 3 times (Jul 3, 17, 31) — not the usual 2.
  test('fortnightly bill due Jul 3 yields 3 occurrences across July', () => {
    const julyStart = new Date(2026, 6, 1); // Jul 1 2026
    const fortnightly = [{ id: 'f', name: 'Gym', amount: 50, type: 'expense',
      frequency: 'fortnightly', category: 'Health', nextDue: '2026-07-03' }];
    const inJuly = buildCashFlow(fortnightly, julyStart, 31) // [Jul 1, Aug 1)
      .filter(e => e.dueDate.getMonth() === 6);
    expect(inJuly).toHaveLength(3);
    expect(inJuly.map(e => e.dueStr)).toEqual(['2026-07-03', '2026-07-17', '2026-07-31']);
  });

  // The anchor must thread through the generator, not just the raw helper:
  // a Jan-31 monthly bill hits month-ends without skipping February.
  test('monthly bill due Jan 31 lands on month-ends through the generator', () => {
    const janStart = new Date(2026, 0, 1);
    const entry = [{ id: 'm', name: 'Rent', amount: 100, type: 'expense',
      frequency: 'monthly', category: 'Housing', nextDue: '2026-01-31' }];
    const events = buildCashFlow(entry, janStart, 120); // [Jan 1, ~May 1)
    expect(events.map(e => e.dueStr)).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
    ]);
  });
});

// ─── prevFreq ─────────────────────────────────────────────────────────────────

describe('prevFreq', () => {
  // Use the Date(y,m,d) constructor for local midnight — avoids UTC/local drift
  const base = new Date(2026, 5, 15); // June 15

  test('weekly goes back 7 days',             () => { const r = prevFreq(base, 'weekly');      expect(r.getDate()).toBe(8);  expect(r.getMonth()).toBe(5); });
  test('fortnightly goes back 14 days',       () => { const r = prevFreq(base, 'fortnightly'); expect(r.getDate()).toBe(1);  expect(r.getMonth()).toBe(5); });
  test('monthly goes back 1 month',           () => { const r = prevFreq(base, 'monthly');     expect(r.getDate()).toBe(15); expect(r.getMonth()).toBe(4); });
  test('quarterly goes back 3 months',        () => { const r = prevFreq(base, 'quarterly');   expect(r.getDate()).toBe(15); expect(r.getMonth()).toBe(2); });
  test('biannual goes back 6 months',         () => { const r = prevFreq(base, 'biannual');    expect(r.getDate()).toBe(15); expect(r.getMonth()).toBe(11); expect(r.getFullYear()).toBe(2025); });
  test('yearly goes back 1 year',             () => { const r = prevFreq(base, 'yearly');      expect(r.getDate()).toBe(15); expect(r.getFullYear()).toBe(2025); });

  test('is the inverse of addFreq (weekly)',  () => {
    const d = new Date(2026, 0, 7);
    expect(prevFreq(addFreq(d, 'weekly'),  'weekly').getTime()).toBe(d.getTime());
  });
  test('is the inverse of addFreq (monthly)', () => {
    // Use mid-month to avoid end-of-month overflow (e.g. Mar 31 + 1mo = May 1)
    const d = new Date(2026, 2, 15);
    expect(prevFreq(addFreq(d, 'monthly'), 'monthly').getTime()).toBe(d.getTime());
  });

  test('does not mutate the original date',   () => {
    const d = new Date(2026, 5, 15);
    prevFreq(d, 'monthly');
    expect(d.getMonth()).toBe(5);
  });
});

// ─── getCurrentCycleWindow ────────────────────────────────────────────────────
//
// All dates use new Date(y,m,d) for local midnight, consistent with how the
// function parses lastPayDate ("T00:00:00" suffix = local midnight).

describe('getCurrentCycleWindow', () => {
  const jun17 = new Date(2026, 5, 17); // June 17, local midnight

  describe('fortnightly', () => {
    test('cycle started today — window is [today, today+14)', () => {
      const { start, end } = getCurrentCycleWindow('2026-06-17', 'fortnightly', jun17);
      expect(start.getDate()).toBe(17); expect(start.getMonth()).toBe(5);
      expect(end.getTime() - start.getTime()).toBe(14 * 86400000);
    });

    test('mid-cycle — start stays at lastPayDate', () => {
      // lastPayDate Jun 10, today Jun 17: Jun 10+14=Jun 24 > Jun 17, so still in that cycle
      const { start, end } = getCurrentCycleWindow('2026-06-10', 'fortnightly', jun17);
      expect(start.getDate()).toBe(10); expect(start.getMonth()).toBe(5);
      expect(end.getDate()).toBe(24);   expect(end.getMonth()).toBe(5);
    });

    test('on exact cycle boundary — new cycle begins today', () => {
      // lastPayDate Jun 3, today Jun 17 (exactly 14 days later)
      const { start, end } = getCurrentCycleWindow('2026-06-03', 'fortnightly', jun17);
      expect(start.getDate()).toBe(17); expect(start.getMonth()).toBe(5);
      expect(end.getDate()).toBe(1);    expect(end.getMonth()).toBe(6); // July 1
    });

    test('many cycles in the past — correctly advances to current cycle', () => {
      // lastPayDate May 6, today Jun 17: 42 days = 3 fortnights → current starts Jun 17
      const { start } = getCurrentCycleWindow('2026-05-06', 'fortnightly', jun17);
      expect(start.getDate()).toBe(17); expect(start.getMonth()).toBe(5);
    });

    test('start <= today and end > today', () => {
      const { start, end } = getCurrentCycleWindow('2026-06-10', 'fortnightly', jun17);
      expect(start.getTime()).toBeLessThanOrEqual(jun17.getTime());
      expect(end.getTime()).toBeGreaterThan(jun17.getTime());
    });
  });

  describe('monthly', () => {
    test('mid-cycle — window spans from lastPayDate to next month', () => {
      // lastPayDate Jun 1, today Jun 17 → cycle [Jun 1, Jul 1)
      const { start, end } = getCurrentCycleWindow('2026-06-01', 'monthly', jun17);
      expect(start.getDate()).toBe(1);  expect(start.getMonth()).toBe(5);
      expect(end.getDate()).toBe(1);    expect(end.getMonth()).toBe(6);
    });

    test('on exact monthly boundary — new cycle begins today', () => {
      // lastPayDate May 17, today Jun 17 → cycle [Jun 17, Jul 17)
      const { start, end } = getCurrentCycleWindow('2026-05-17', 'monthly', jun17);
      expect(start.getDate()).toBe(17); expect(start.getMonth()).toBe(5);
      expect(end.getDate()).toBe(17);   expect(end.getMonth()).toBe(6);
    });

    test('start <= today and end > today', () => {
      const { start, end } = getCurrentCycleWindow('2026-06-01', 'monthly', jun17);
      expect(start.getTime()).toBeLessThanOrEqual(jun17.getTime());
      expect(end.getTime()).toBeGreaterThan(jun17.getTime());
    });
  });
});

// ─── getExpensesDueInCycle ────────────────────────────────────────────────────
//
// Window: [Jun 17, Jul 1) local midnight — a standard fortnightly cycle.

describe('getExpensesDueInCycle', () => {
  const cycleStart = new Date(2026, 5, 17); // June 17, local midnight
  const cycleEnd   = new Date(2026, 6, 1);  // July 1,  local midnight

  const expense = (id, frequency, nextDue) => ({
    id, type: 'expense', name: 'Test', amount: 100, frequency, category: 'Other', nextDue,
  });

  test('empty entries returns []', () =>
    expect(getExpensesDueInCycle([], cycleStart, cycleEnd)).toHaveLength(0));

  test('income entries are excluded', () => {
    const income = [{ id: '1', type: 'income', name: 'Salary', amount: 5000,
      frequency: 'fortnightly', category: 'Salary', nextDue: '2026-06-20' }];
    expect(getExpensesDueInCycle(income, cycleStart, cycleEnd)).toHaveLength(0);
  });

  test('expense with nextDue inside window is included once', () => {
    const result = getExpensesDueInCycle([expense('1', 'monthly', '2026-06-20')], cycleStart, cycleEnd);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
    expect(result[0].dueInCycle.getDate()).toBe(20);
  });

  test('weekly expense whose nextDue is before window advances into window', () => {
    // nextDue = Jun 10 → advance: Jun 10 → 17 → 24 (two occurrences in [Jun 17, Jul 1))
    const result = getExpensesDueInCycle([expense('1', 'weekly', '2026-06-10')], cycleStart, cycleEnd);
    expect(result).toHaveLength(2);
    expect(result[0].dueInCycle.getDate()).toBe(17);
    expect(result[1].dueInCycle.getDate()).toBe(24);
  });

  test('weekly expense whose nextDue is after window looks back to find occurrence', () => {
    // nextDue = Jul 5 → prev = Jun 28, which is in [Jun 17, Jul 1)
    const result = getExpensesDueInCycle([expense('1', 'weekly', '2026-07-05')], cycleStart, cycleEnd);
    expect(result).toHaveLength(1);
    expect(result[0].dueInCycle.getDate()).toBe(28);
    expect(result[0].dueInCycle.getMonth()).toBe(5); // June
  });

  test('monthly expense whose only occurrence in period is before window — excluded', () => {
    // nextDue = Jul 15, prev = Jun 15 < cycleStart, advance = Jul 15 > cycleEnd → none
    expect(getExpensesDueInCycle([expense('1', 'monthly', '2026-07-15')], cycleStart, cycleEnd))
      .toHaveLength(0);
  });

  test('monthly expense with nextDue before window and no occurrence in window', () => {
    // nextDue = Jun 10, advance = Jul 10 > cycleEnd → none
    expect(getExpensesDueInCycle([expense('1', 'monthly', '2026-06-10')], cycleStart, cycleEnd))
      .toHaveLength(0);
  });

  test('results are sorted by dueInCycle ascending', () => {
    const entries = [
      expense('a', 'weekly',  '2026-06-19'), // → Jun 19, Jun 26
      expense('b', 'monthly', '2026-06-18'), // → Jun 18
    ];
    const result = getExpensesDueInCycle(entries, cycleStart, cycleEnd);
    for (let i = 1; i < result.length; i++)
      expect(result[i].dueInCycle.getTime()).toBeGreaterThanOrEqual(result[i-1].dueInCycle.getTime());
  });

  test('multiple entries — each contributes correctly', () => {
    const entries = [
      expense('rent',    'monthly',     '2026-06-20'), // 1 occurrence
      expense('phone',   'fortnightly', '2026-06-17'), // 1 occurrence (Jun 17)
      expense('parking', 'weekly',      '2026-06-17'), // 2 occurrences (Jun 17, Jun 24)
    ];
    expect(getExpensesDueInCycle(entries, cycleStart, cycleEnd)).toHaveLength(4);
  });
});

// ─── sumActualForMonth ────────────────────────────────────────────────────────
//
// Calendar-accurate totals for the month containing `today` — counts REAL
// occurrences, unlike toMonthly's averaged multipliers.

describe('sumActualForMonth', () => {
  const entry = (type, frequency, nextDue, amount = 100) => ({
    id: nextDue, name: 'Test', type, frequency, category: 'Other', nextDue, amount,
  });

  test('empty entries → all zero', () => {
    expect(sumActualForMonth([], new Date(2026, 6, 1))).toEqual({ income: 0, expenses: 0, net: 0 });
  });

  test('3-fortnightly month counts the real (higher) total, exceeding the average', () => {
    // July 2026: fortnightly due Jul 3 falls Jul 3/17/31 → 3 × 100 = 300
    const july = new Date(2026, 6, 15);
    const { expenses } = sumActualForMonth([entry('expense', 'fortnightly', '2026-07-03')], july);
    expect(expenses).toBe(300);
    expect(expenses).toBeGreaterThan(toMonthly(100, 'fortnightly')); // > 216.67 average
  });

  test('2-fortnightly month counts exactly 2', () => {
    // June 2026: fortnightly due Jun 5 → Jun 5/19 only → 2 × 100 = 200
    const june = new Date(2026, 5, 15);
    const { expenses } = sumActualForMonth([entry('expense', 'fortnightly', '2026-06-05')], june);
    expect(expenses).toBe(200);
  });

  test('5-weekly month counts 5', () => {
    // May 2026 has 5 Fridays (1, 8, 15, 22, 29); weekly due May 1 → 5 × 100 = 500
    const may = new Date(2026, 4, 15);
    const { expenses } = sumActualForMonth([entry('expense', 'weekly', '2026-05-01')], may);
    expect(expenses).toBe(500);
  });

  test('monthly entry counts exactly once regardless of anchor day', () => {
    // A Jan-31 monthly bill, evaluated in February, still occurs once (Feb 28)
    const feb = new Date(2026, 1, 15);
    const { expenses } = sumActualForMonth([entry('expense', 'monthly', '2026-01-31')], feb);
    expect(expenses).toBe(100);
  });

  test('splits income and expenses and computes net', () => {
    const june = new Date(2026, 5, 15);
    const entries = [
      entry('income',  'monthly',     '2026-06-01', 5000), // 5000
      entry('expense', 'fortnightly', '2026-06-05', 100),  // Jun 5/19 → 200
    ];
    expect(sumActualForMonth(entries, june)).toEqual({ income: 5000, expenses: 200, net: 4800 });
  });
});
