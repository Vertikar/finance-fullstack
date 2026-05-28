import { toMonthly, addFreq, fmt, fmtFull, savingsRate, buildCashFlow } from './utils';

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
// Important: use UTC midnight (new Date('YYYY-MM-DD T00:00:00.000Z')) as the
// `today` anchor so it matches how date strings in nextDue are parsed by
// new Date('YYYY-MM-DD') — both resolve to UTC midnight, avoiding timezone drift.

describe('buildCashFlow', () => {
  const today = new Date('2026-06-01T00:00:00.000Z'); // UTC midnight — stable across all timezones

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
});
