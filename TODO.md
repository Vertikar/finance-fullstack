# Finance Fullstack — TODO

Follow-ups and out-of-scope items captured from merged PRs, in the
[todo.md](https://github.com/todomd/todo.md) format. Each item is also recorded
in its originating PR's `## Testing & follow-up` checklist.

### Todo

- [ ] Show each expense category's existing recurring spend alongside its allowance input on the Budget tab #frontend #pr-19
- [ ] Spent-vs-budget tracking with progress bars (requires per-purchase logging) #frontend #backend #pr-19
- [ ] Fix `getCurrentCycleWindow` monthly branch — still uses plain `setMonth()` and shares the end-of-month overflow bug (a pay date on the 31st can produce a malformed cycle window); flagged with a code comment #frontend #pr-20
- [ ] Calendar-accurate backend summary — `/api/entries/summary` uses fixed average multipliers, so a "heavy" month (3 fortnightly payments) isn't reflected server-side; intentional for now #backend #pr-20
- [ ] Upcoming panel enumerates only each entry's stored `nextDue` (past dates hidden) instead of the true next occurrence; advance `nextDue` on the fly so it always shows a future date #frontend #pr-20
- [ ] Advance stored `nextDue` after a payment passes (job or post-payment hook) so persisted dates don't drift into the past #backend #pr-20
- [ ] Add an actual "this month" net sub-figure to the Overview Net card, matching the Income/Expenses cards #frontend #pr-20
- [ ] Add `prevFreq`/`addFreq` round-trip symmetry tests (e.g. `prevFreq(addFreq(Jan31, monthly, 31), monthly, 31) === Jan31`) as a regression guard #frontend #pr-20
- [ ] Per-bucket budget targets (e.g. "keep lifestyle under $X/month") #frontend #backend #pr-26
- [ ] Bucket views in the Cash Flow and Pay Cycle tabs (Phase 1 only added Overview card + Payments filter) #frontend #pr-26
- [ ] Admin page for category management — add/rename/re-bucket/retire categories + colour picker, CRUD over the `categories` table #frontend #backend #pr-26
- [ ] Add FK `entries.category` → `categories(id)` once the category admin page lands (kept as free-text TEXT for now to avoid a risky data migration) #backend #pr-26
- [ ] Add the remaining import presets (CommBank, Up, ubank, ING Direct, AustralianSuper) once a real export of each is available to confirm its column layout — the mapper already supports headerless files, debit/credit merging and per-format dates, so each is an `import_sources` row #backend #pr-28
- [ ] Map Up's own category taxonomy to app categories (initially left in `category_raw` for the review step) #backend #pr-28
- [ ] Refactor `import_export.go`'s inline date parsing to use `importer.ParseDate` — the entries importer still has its own nested if/else version accepting a narrower set of formats #backend #pr-28
- [ ] `backend/testdata/finance.csv` is dead weight: it duplicates the `seedCSV` const in `fixtures_test.go` byte-for-byte and nothing reads it, so the two can drift silently. Either wire the tests to read the file or delete it #backend #pr-28
- [ ] `GET/POST /api/import-sources` for managing user-level saved column maps (built-in presets stay read-only) — schema supports it via the nullable `import_sources.user_id` #backend #pr-28

### In Progress

### Done ✓
