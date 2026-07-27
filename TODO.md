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
- [ ] `.env` is tracked in git despite the README's "Never commit `.env`" — untrack it, add it to `.gitignore`, and rotate the committed `DB_PASSWORD` / `JWT_SECRET` #chore #pr-31
- [ ] Warn on restore when the dump's `schema_migrations` version doesn't match the migrations embedded in the running API binary, instead of leaving it to `make db-version` after the fact #devex #pr-31
- [ ] Write backups to a `backups/` directory rather than the project root #devex #pr-31
- [ ] `COMMENT ON EXTENSION "uuid-ossp"` in a dump requires extension ownership; under the new `ON_ERROR_STOP=1` this would abort a restore run as a non-owner role. Add `--no-comments` to `make backup` if that ever bites #backend #pr-31
- [ ] Fail fast on migration errors instead of crash-looping, and make the error message name both versions (issue 1, items 1–2) #backend
- [ ] CI check for migration hygiene — up/down parity, contiguous versions, up→down→up round-trip (issue 2) #ci #backend

### In Progress

### Done ✓
