# Todo / Follow-ups

## From PR #20 — Payment frequency date-handling edge cases

### Out of scope (deferred)

- **`getCurrentCycleWindow` monthly overflow** (`frontend/src/utils.js`): the monthly
  branch uses plain `setMonth()` and shares the same end-of-month normalization bug
  fixed in `addFreq`/`shiftMonths`. A pay date on the 31st can produce a malformed
  cycle window (e.g. Jan 31 pay date drifts to Mar 3 after one cycle). Flagged with a
  code comment; fix was out of scope for #20.

- **Backend `freqMultiplier` accuracy** (`backend/handlers/entries.go`): the
  `/api/entries/summary` endpoint uses fixed average multipliers (e.g. fortnightly =
  26/12) rather than counting real occurrences. This is intentional — it gives a
  long-run monthly average — but a "heavy" month (3 fortnightly payments) will not be
  reflected in the backend summary. A calendar-accurate backend summary endpoint would
  require date-stepping logic mirrored from the frontend.

- **`Upcoming` section only shows stored `nextDue`**: the Upcoming panel in the
  Overview tab displays each entry at most once (its stored `nextDue` date) and filters
  out past dates. It does not enumerate multiple future occurrences the way the Cash
  Flow tab does. Entries with a past `nextDue` are silently hidden. A follow-up could
  advance `nextDue` on the fly (or server-side) so the panel always shows the true next
  occurrence.

- **`nextDue` staleness**: the app never updates `nextDue` in the database after a
  payment passes. All date-stepping is done client-side at render time. If a user adds
  an entry with a past `nextDue`, the app walks forward correctly in Cash Flow / Pay
  Cycle, but the stored value drifts further into the past over time. A background job
  or post-payment hook to advance `nextDue` would keep the data clean.

### Follow-up improvements

- **Overview "this month" sub for Net**: the Income and Expenses stat cards now show
  an actual `this month` sub-figure (PR #20). The Net card still shows the averaged
  annual net. Consider adding an actual net sub (`actualIncome - actualExpenses`) for
  consistency.

- **Test coverage for `prevFreq` symmetry**: the plan called for
  `prevFreq(addFreq(Jan31, monthly, 31), monthly, 31) === Jan31` round-trip tests.
  These were not added in PR #20 and would be a useful regression guard.
