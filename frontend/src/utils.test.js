import { toMonthly, addFreq, fmt, fmtFull, savingsRate, buildCashFlow } from './utils';

// ─── toMonthly ───────────────────────────────────────────────────────────────

describe('toMonthly', () => {
  test('monthly amount is unchanged', () => {
    expect(toMonthly(1000, 'monthly')).toBeCloseTo(1000);
  });

  test('weekly amount is multiplied by 52/12', () => {
    expect(toMonthly(100, 'weekly')).toBeCloseTo(100 * 52 / 12);
  });

  test('fortnightly amount is multiplied by 26/12', () => {
    expect(toMonthly(200, 'fortnightly')).toBeCloseTo(200 * 26 / 12);
  });

  test('quarterly amount is divided by 3', () => {
    expect(toMonthly(300, 'quarterly')).toBeCloseTo(100);
  });

  test('yearly amount is divided by 12', () => {
    expect(toMonthly(1200, 'yearly')).toBeCloseTo(100);
  });

  test('unknown frequency defaults to multiplier 1', () => {
    expect(toMonthly(500, 'unknown')).toBeCloseTo(500);
  });

  test('zero amount returns zero', () => {
    expect(toMonthly(0, 'monthly')).toBe(0);
  });
});

// ─── addFreq ─────────────────────────────────────────────────────────────────

describe('addFreq', () => {
  const base = new Date('2026-01-01');

  test('weekly adds 7 days', () => {
    expect(addFreq(base, 'weekly').toISOString().split('T')[0]).toBe('2026-01-08');
  });

  test('fortnightly adds 14 days', () => {
    expect(addFreq(base, 'fortnightly').toISOString().split('T')[0]).toBe('2026-01-15');
  });

  test('monthly advances by one month', () => {
    expect(addFreq(base, 'monthly').toISOString().split('T')[0]).toBe('2026-02-01');
  });

  test('quarterly advances by 3 months', () => {
    expect(addFreq(base, 'quarterly').toISOString().split('T')[0]).toBe('2026-04-01');
  });

  test('yearly advances by one year', () => {
    expect(addFreq(base, 'yearly').toISOString().split('T')[0]).toBe('2027-01-01');
  });

  test('does not mutate the original date', () => {
    const original = new Date('2026-06-15');
    addFreq(original, 'monthly');
    expect(original.toISOString().split('T')[0]).toBe('2026-06-15');
  });
});

// ─── fmt / fmtFull ───────────────────────────────────────────────────────────

describe('fmt', () => {
  test('formats positive number as AUD with no decimals', () => {
    expect(fmt(1234)).toMatch(/\$1,234/);
  });

  test('treats negative numbers as absolute values', () => {
    expect(fmt(-500)).toMatch(/\$500/);
  });

  test('rounds to whole dollars', () => {
    expect(fmt(99.9)).toMatch(/\$100/);
  });
});

describe('fmtFull', () => {
  test('formats with exactly 2 decimal places', () => {
    expect(fmtFull(9.5)).toMatch(/\$9\.50/);
  });

  test('treats negative numbers as absolute values', () => {
    expect(fmtFull(-100)).toMatch(/\$100\.00/);
  });
});

// ─── savingsRate ──────────────────────────────────────────────────────────────

describe('savingsRate', () => {
  test('returns 0 when income is zero', () => {
    expect(savingsRate(0, 500)).toBe(0);
  });

  test('returns 0 when income is negative', () => {
    expect(savingsRate(-100, 0)).toBe(0);
  });

  test('calculates correct rate with surplus', () => {
    expect(savingsRate(4000, 3000)).toBeCloseTo(25);
  });

  test('returns negative rate when expenses exceed income', () => {
    expect(savingsRate(1000, 1500)).toBeCloseTo(-50);
  });

  test('returns 100 when expenses are zero', () => {
    expect(savingsRate(2000, 0)).toBeCloseTo(100);
  });
});

// ─── buildCashFlow ────────────────────────────────────────────────────────────

describe('buildCashFlow', () => {
  const today = new Date('2026-06-01');
  today.setHours(0, 0, 0, 0);

  const entries = [
    { id: '1', name: 'Rent', amount: 1800, type: 'expense', frequency: 'monthly',
      category: 'Housing', nextDue: '2026-06-01' },
    { id: '2', name: 'Salary', amount: 5000, type: 'income', frequency: 'monthly',
      category: 'Salary', nextDue: '2026-06-15' },
  ];

  test('returns events sorted by date', () => {
    const events = buildCashFlow(entries, today, 90);
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].dueDate.getTime()).toBeGreaterThanOrEqual(events[i - 1].dueDate.getTime());
    }
  });

  test('monthly entry appears multiple times over 90 days', () => {
    const events = buildCashFlow(entries, today, 90);
    const rentEvents = events.filter(e => e.id === '1');
    expect(rentEvents.length).toBe(3); // June, July, August
  });

  test('events have dueStr in YYYY-MM-DD format', () => {
    const events = buildCashFlow(entries, today, 90);
    events.forEach(e => {
      expect(e.dueStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  test('no events returned when window is 0 days', () => {
    const events = buildCashFlow(entries, today, 0);
    expect(events).toHaveLength(0);
  });

  test('past nextDue is advanced to today or future before counting', () => {
    const pastEntry = [
      { id: '3', name: 'Old Bill', amount: 100, type: 'expense', frequency: 'monthly',
        category: 'Utilities', nextDue: '2026-01-01' },
    ];
    const events = buildCashFlow(pastEntry, today, 60);
    events.forEach(e => {
      expect(new Date(e.dueStr).getTime()).toBeGreaterThanOrEqual(today.getTime());
    });
  });
});
