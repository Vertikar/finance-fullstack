# Feature scope: Transaction import, recurring-entry detection & buckets

Status: **v2.1 — decisions incorporated (buckets freely assignable)** · 2026-07-24
Validated against: `frollo transactions_20260603.csv` (3,112 rows, CommBank/Up/ubank, Jun 2025–Jun 2026)

## 0. Decisions log (from review)

1. **Categories**: adopt all new categories found in the Frollo import (not bucketed into "Other") — see §3.
2. **Natalie's recurring transfer**: treated as a **transfer, excluded from income** and from detection.
3. **Confidence threshold**: ship with 0.5 default, **tune against real data** after first import — tracked as a follow-up.
4. **Import presets**: support raw CSV exports from **CommBank, Up, ubank, ING Direct, AustralianSuper** in addition to Frollo — see §7.
5. **New in v2 — Buckets**: adopt Frollo's `budget_category` as a first-class higher-level grouping ("buckets") above categories — see §3a. **v2.1 correction**: bucket assignment is free-form — any category can go in any bucket (its bucket is just a default), and any individual transaction can be overridden into any bucket independent of its category.
6. **Deferred**: admin page for managing categories — on the todo list as its own future feature, enabled by the DB-backed categories table introduced here.

## 1. Goal

Import raw bank-transaction exports (Frollo aggregated CSV first, raw bank CSVs as presets) and have
the app propose recurring entries by detecting repeating merchant + amount + interval patterns.
Phased:

- **Phase 1** (this scope): store transactions permanently, run detection, review/approve
  candidates into the existing `entries` table. Introduce buckets + DB-backed categories.
- **Phase 2** (later): browsable transaction ledger with actual-vs-budget reconciliation.
  Phase 1's schema (`matched_entry_id`, stored raw rows) makes this additive.

## 2. What the sample data shows

Interval analysis over the sample (excluding transfers/round-ups/interest/fees) yields two dozen+
high-confidence recurring candidates:

| Description | Amount | Occurrences | Median gap | Gap stdev | Inferred frequency |
|---|---|---|---|---|---|
| Loan Repayment, LN REPAY 885202194 | -$1,823.00 | 26 | 14.0d | 0.3 | fortnightly |
| Telstra | -$39.00 / -$80.00 | 13 | 28.0d | 0.0 | monthly |
| Direct Debit RACV Insurance | -$200.21 | 12 | 30.0d | 1.5 | monthly |
| Disney Plus Aus | -$20.99 | 11 | 31.0d | 0.9 | monthly |
| AWS (Amazon Web Services) | -$4.11 | 11 | 31.0d | 0.9 | monthly |
| PayPal Australia direct debit | -$3.65 | 11 | 31.0d | 1.3 | monthly |
| AAMI | -$171.52 | 10 | 30.0d | 1.9 | monthly |
| Yarra Valley Water BPAY | -$40.00 | 9 | 30.5d | 1.0 | monthly |

Near-zero stdev on true recurring bills cleanly separates them from noise (e.g. Amazon retail:
20d median gap but 19.3d stdev — correctly rejected).

Excluded from detection (grounded in the sample):

- **Round-ups** — `category_name = 'Round Up'` (89 rows) and micro-amounts; amount floor $2.
- **All transfers** — `transaction_type` in `transfer_incoming`/`transfer_outgoing`, and
  `category_name` in `Transfer Between Accounts` / `Transfer In` / `Transfer Out` /
  `Credit Card Payments`. **Per decision 2 this includes Natalie's recurring fortnightly
  transfer** — structurally recurring, but it is money movement, not income.
- **Interest & fees** — `interest_paid`, `interest_charged`, `fee`, `Service Charges/Fees`,
  `ATM/Cash Withdrawals`.
- **`included = false`** rows (308) — Frollo's own exclusion flag, respected as default filter;
  raw rows still stored for Phase 2.

## 3. Categories — DB-backed, expanded from the Frollo taxonomy

Per decision 1, every meaningful Frollo `category_name` becomes an app category. This makes the
hard-coded `CATEGORIES` / `CAT_COLORS` constants in `App.js` untenable (~20 new categories), so
categories move to a **`categories` table** (migration), seeded with the existing 18 app
categories plus the new ones below. The frontend fetches them once at load
(`GET /api/categories`). This is also the foundation the future **category admin page** builds on
(CRUD UI over the same table — separate feature, already on the todo list).

**Existing app categories with a direct Frollo equivalent (mapped, no new category):**

| Frollo | App category |
|---|---|
| Groceries | Food & Groceries |
| Healthcare/Medical | Health |
| Mortgage | Housing |
| Utilities | Utilities |
| Insurance | Insurance |
| Education | Education |
| Clothing/Shoes | Clothing |
| Subscriptions/Renewals | Subscriptions |
| Entertainment/Recreation | Entertainment |
| Savings | Savings |
| Salary/Regular Income | Salary |
| Interest Income | Investment |

**New categories to seed (from the Frollo import):**

Expense — Takeaway & Snacks, Restaurants, Cafes & Coffee, Bars & Pubs, Alcohol,
General Merchandise, Child/Dependent Expenses, Petrol, Public Transport, Automotive,
Home Renovation & Maintenance, Cable/Satellite/Telecom, Taxes, Land Tax & Strata Fees,
Charitable Giving, Gifts, Electronics, Beauty & Well-being, Office Expenses, Hobbies,
Travel/Holidays, Furniture & Homeware, Buy Now Pay Later, Services/Supplies,
Postage/Shipping, Business Miscellaneous.

Income — Refunds/Adjustments, Super Contributions.

Never imported as categories (excluded noise): Transfer Between Accounts, Transfer In,
Transfer Out, Credit Card Payments, Round Up, Service Charges/Fees, ATM/Cash Withdrawals,
Uncategorised, Notes, Expense Reimbursement, Printing (1 row).

Each new category needs a `CAT_COLORS` colour; colours move into the `categories` table
(`color` column) so the admin page can manage them later.

## 3a. Buckets (new feature)

Frollo's `budget_category` is a four-value higher-level grouping — **income, living, lifestyle,
goals** — commonly called *buckets*. Adopted as a first-class concept:

**Model — buckets are freely assignable, not fixed.** Category↔bucket and
transaction↔bucket pairings are user decisions, not derived constants:

- `categories.bucket` (`TEXT NOT NULL CHECK (bucket IN ('income','living','lifestyle','goals'))`)
  is a **default only**. The seed assignment follows Frollo's pairing in the sample (e.g.
  Groceries/Utilities/Mortgage → living; Restaurants/Subscriptions → lifestyle;
  Savings/Super Contributions → goals; Salary/Investment → income), but any category can be
  moved to any bucket — editable now via the review flow, and later via the category admin page.
- `transactions.bucket` (same CHECK, `NULL` allowed) is a **per-transaction override**:
  `NULL` = inherit the category's bucket; a value = this transaction was explicitly placed in
  a different bucket. Effective bucket = `COALESCE(transactions.bucket, category.bucket)`.
  Example from the sample: Frollo itself files one-off "Savings"-category rows under different
  buckets depending on context — the override preserves that flexibility.

**Import.** The Frollo preset stores `budget_category` into `bucket_raw` and uses it to
pre-fill the per-transaction bucket where it disagrees with the assigned category's default
(so Frollo's own placement is preserved, but remains editable). Raw bank CSVs (no bucket
column) start from the category's default bucket, overridable per transaction at review.

**UI (Phase 1 scope, kept deliberately small):**
- Overview: an "By Bucket" breakdown card (living vs lifestyle vs goals monthly-equivalent,
  income separate) alongside the existing category pie.
- Payments tab: bucket filter row (mirroring the existing rhythm filter).
- Import review screen: a bucket dropdown on every candidate/transaction row (defaulted per
  the rules above), alongside the category dropdown — either can be changed independently.
- Bucket accent colours: reuse the dark-luxury palette (suggest gold `#c4a24a` for goals,
  and three muted tones for the rest — final pick during implementation).

**Deferred to later** (noted in TODO): per-bucket budget targets ("keep lifestyle under
$X/month"), bucket view in Cash Flow and Pay Cycle tabs.

## 4. Data model

Migrations `005_create_categories.up/down.sql` and `006_create_transactions.up/down.sql`:

```sql
-- 005: categories + buckets
CREATE TABLE categories (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       TEXT NOT NULL UNIQUE,
    type       TEXT NOT NULL CHECK (type IN ('income','expense')),
    bucket     TEXT NOT NULL CHECK (bucket IN ('income','living','lifestyle','goals')),
    color      TEXT NOT NULL,
    sort_order INT  NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- seeded with existing 18 + new Frollo-derived categories (§3).
-- entries.category keeps its TEXT form for now (no FK) to avoid a risky data
-- migration; admin-page feature can tighten this later.

-- 006: import machinery
CREATE TABLE import_sources (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,          -- "Frollo", "CommBank", …
    column_map JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE import_batches (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id   UUID REFERENCES import_sources(id),
    filename    TEXT,
    row_count   INT NOT NULL DEFAULT 0,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transactions (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    import_batch_id  UUID REFERENCES import_batches(id) ON DELETE CASCADE,
    external_id      TEXT,
    description      TEXT NOT NULL,
    amount           NUMERIC(12,2) NOT NULL,  -- signed
    currency         TEXT NOT NULL DEFAULT 'AUD',
    transaction_date DATE NOT NULL,
    account_name     TEXT,
    provider_name    TEXT,
    category_raw     TEXT,                    -- source category
    bucket_raw       TEXT,                    -- Frollo budget_category, when present
    bucket           TEXT CHECK (bucket IN ('income','living','lifestyle','goals')),
                                              -- per-transaction override; NULL = inherit
                                              -- from category's default bucket
    transaction_type TEXT,
    included         BOOLEAN NOT NULL DEFAULT TRUE,
    matched_entry_id UUID REFERENCES entries(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_transactions_external_id
    ON transactions(user_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_transactions_user_date ON transactions(user_id, transaction_date);
```

For raw bank CSVs without a transaction ID, `external_id` is a computed hash of
`(date, amount, normalized description, account)` so re-importing an overlapping export
dedupes rather than duplicating.

## 5. Detection algorithm

1. **Filter**: exclude transfers (all forms, incl. Natalie's — decision 2), interest, fees,
   round-ups, `included = false`, `abs(amount) < $2`.
2. **Normalize key**: lowercase, strip digits/punctuation, collapse whitespace.
3. **Group**: `(normalized_key, round(amount))` exact pass; ±10% fuzzy second pass for groups
   short of 3 occurrences (drifting bills like electricity).
4. **Require ≥3 occurrences.**
5. **Classify frequency** by median gap: 5–9d weekly · 10–18d fortnightly · 25–35d monthly ·
   80–100d quarterly · 170–195d biannual · 350–380d yearly · else dropped.
6. **Confidence**: `min(occurrences/5, 1) × clamp(1 − stdev/median, 0, 1)`. Default surface
   threshold **0.5**, exposed as a slider in the review UI so it can be tuned live against
   real data (decision 3); follow-up item to settle a default after first real import.
7. **Candidate**: editable name, median amount, type from sign, frequency, category (mapped
   §3) + bucket (§3a), `next_due` = last occurrence + interval, confidence, source
   transaction IDs.

## 6. Dedup against existing entries

Cross-reference candidates against existing `entries` (normalized-name + amount ±10% + same
frequency). Matches present as **"update existing"** not "create new" — mortgage, Telstra,
insurance likely already exist as manual entries; duplicates would double-count the KPIs.

## 7. Import presets (decision 4)

Generic column-mapper engine; each preset is a saved `import_sources.column_map` seeded
globally. Auto-detect the preset from the header row where possible.

| Preset | Notes on the raw format |
|---|---|
| **Frollo** | 18-column export as per sample; richest — has category, bucket, external ID, `included` flag. |
| **CommBank** | CSV export has **no header row**: `Date (DD/MM/YYYY), Amount, Description, Balance`. No category/ID → hashed `external_id`, category assigned at review. |
| **Up** | Headered CSV: Time (ISO), BSB/Account, Transaction Type, Payee, Description, Category, Tags, Subtotal, Currency, Fee, Round Up, Total. Has its own category taxonomy → second mapping table, or leave `category_raw` and assign at review (recommended initially). |
| **ubank** | Headered CSV: Date, Description, Debit, Credit, Balance (debit/credit as separate columns → merge to signed amount). |
| **ING Direct** | Headered CSV: Date (DD/MM/YYYY), Description, Credit, Debit, Balance — same merge treatment. |
| **AustralianSuper** | Transaction export: Date, Transaction type, Description, Amount. Almost entirely contributions/returns → categories Super Contributions / Investment, bucket goals/income. Low volume (1 row in sample). |

Exact column layouts to be verified against a real export of each during implementation —
formats above are from documented exports and may have shifted. Each preset ships with a
small fixture CSV in `backend/testdata/` and a parser test.

Per-bank date formats (`DD/MM/YYYY` vs ISO) and debit/credit-column merging are handled by
the mapper config (`date_format`, `amount_mode: signed|debit_credit` keys in `column_map`).

## 8. API surface (new)

- `GET /api/categories` — full category list with bucket + colour (public to authed users).
- `POST /api/transactions/import` — multipart CSV + `source_id`/inline map →
  `{batch_id, imported, skipped_duplicates, errors}`.
- `GET /api/transactions/import/:batchId/candidates?threshold=0.5` — detection results.
- `POST /api/transactions/import/:batchId/apply` — `[{candidate, action: create|update|skip, entry_id?}]`,
  transactional; sets `matched_entry_id` on source rows.
- `DELETE /api/transactions/import/:batchId` — undo batch (created entries left alone).
- `GET/POST /api/import-sources` — user-level preset management (global presets read-only).

## 9. Frontend

New `TransactionImport.js` (theme system as usual; reuse `parseCSVLine`/`parseCSVText`
exported from `ImportModal.js` in PR #23). Flow: **Upload → preset auto-detect / column map →
review candidates (confidence slider, inline edit, bucket & category dropdowns from
`/api/categories`, "matches existing" hints) → apply**. Entry point: "↑ Import Transactions"
button beside the existing Export/Import controls on the Payments tab.

`CATEGORIES`/`CAT_COLORS` constants in `App.js` replaced by a fetch of `/api/categories`
(kept as fallback constants for offline/error rendering). Bucket breakdown card on Overview +
bucket filter on Payments per §3a.

## 10. Branch/PR breakdown

Following repo conventions (`type/short-description`, `## Testing & follow-up` checklist,
TODO.md logging):

1. `feature/categories-and-buckets` — migration 005, seed data, `GET /api/categories`,
   frontend switch from constants to fetched categories, bucket card + filter. Independently
   shippable and visibly useful on its own.
2. `feature/transactions-schema-and-import` — migration 006, mapper engine + 6 presets,
   import endpoint + dedup, fixtures & backend tests. Depends on (1) for category/bucket
   assignment.
3. `feature/recurring-detection-engine` — detection + candidates + apply/undo endpoints,
   backend tests. Depends on (2).
4. `feature/transaction-import-ui` — `TransactionImport.js` + review flow + frontend tests.
   Depends on (1)–(3).

## 11. Follow-ups (for TODO.md when PRs open)

- Tune detection confidence threshold default after first real import (decision 3).
- **Admin page for category management** (add/rename/re-bucket/retire categories, colour
  picker) — separate future feature, foundation laid by the `categories` table.
- Per-bucket budget targets; bucket views in Cash Flow / Pay Cycle tabs.
- Map Up's category taxonomy to app categories (initially left as `category_raw`).
- Consider FK from `entries.category` → `categories` once admin page lands.
- Phase 2: transaction ledger view + actual-vs-budget reconciliation using `matched_entry_id`.
