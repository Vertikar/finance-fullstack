-- Categories become DB-backed reference data (previously hard-coded in the
-- frontend). This is a GLOBAL table — not per-user — so there is no user_id and
-- it is seeded here rather than in seed.sql. `bucket` is a higher-level grouping
-- (income/living/lifestyle/goals) that entries inherit via their category.
CREATE TABLE categories (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       TEXT NOT NULL UNIQUE,
    type       TEXT NOT NULL CHECK (type IN ('income','expense')),
    bucket     TEXT NOT NULL CHECK (bucket IN ('income','living','lifestyle','goals')),
    color      TEXT NOT NULL,
    sort_order INT  NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: the existing 18 app categories (name/type/color preserved verbatim from
-- the former CATEGORIES + CAT_COLORS constants), each assigned a bucket, plus the
-- Frollo-derived categories. sort_order keeps the familiar categories first and in
-- their original order; new categories follow. All income buckets 'income' except
-- Super Contributions (goals, per the Frollo taxonomy). ON CONFLICT keeps the
-- seed idempotent.
INSERT INTO categories (name, type, bucket, color, sort_order) VALUES
    -- ── Income (existing) ──────────────────────────────────────────────
    ('Salary',                'income',  'income',    '#4ade80',  10),
    ('Freelance',             'income',  'income',    '#34d399',  20),
    ('Investment',            'income',  'income',    '#6ee7b7',  30),
    ('Rental',                'income',  'income',    '#a7f3d0',  40),
    ('Government',            'income',  'income',    '#86efac',  50),
    ('Other Income',          'income',  'income',    '#d1fae5',  60),
    -- ── Income (new, from Frollo) ──────────────────────────────────────
    ('Refunds/Adjustments',   'income',  'income',    '#bbf7d0',  70),
    ('Super Contributions',   'income',  'goals',     '#10b981',  80),
    -- ── Expense (existing) ─────────────────────────────────────────────
    ('Housing',               'expense', 'living',    '#f87171', 100),
    ('Transport',             'expense', 'living',    '#fb923c', 110),
    ('Food & Groceries',      'expense', 'living',    '#fbbf24', 120),
    ('Utilities',             'expense', 'living',    '#a78bfa', 130),
    ('Insurance',             'expense', 'living',    '#60a5fa', 140),
    ('Health',                'expense', 'living',    '#f472b6', 150),
    ('Entertainment',         'expense', 'lifestyle', '#c084fc', 160),
    ('Subscriptions',         'expense', 'lifestyle', '#22d3ee', 170),
    ('Education',             'expense', 'living',    '#818cf8', 180),
    ('Savings',               'expense', 'goals',     '#4ade80', 190),
    ('Clothing',              'expense', 'lifestyle', '#f9a8d4', 200),
    ('Other',                 'expense', 'living',    '#94a3b8', 210),
    -- ── Expense (new, from Frollo) ─────────────────────────────────────
    ('Takeaway & Snacks',          'expense', 'lifestyle', '#fca5a5', 220),
    ('Restaurants',                'expense', 'lifestyle', '#fb7185', 230),
    ('Cafes & Coffee',             'expense', 'lifestyle', '#d6a866', 240),
    ('Bars & Pubs',                'expense', 'lifestyle', '#e879f9', 250),
    ('Alcohol',                    'expense', 'lifestyle', '#c026d3', 260),
    ('General Merchandise',        'expense', 'lifestyle', '#cbd5e1', 270),
    ('Child/Dependent Expenses',   'expense', 'living',    '#fdba74', 280),
    ('Petrol',                     'expense', 'living',    '#f59e0b', 290),
    ('Public Transport',           'expense', 'living',    '#38bdf8', 300),
    ('Automotive',                 'expense', 'living',    '#ea580c', 310),
    ('Home Renovation & Maintenance', 'expense', 'living', '#d97706', 320),
    ('Cable/Satellite/Telecom',    'expense', 'living',    '#8b5cf6', 330),
    ('Taxes',                      'expense', 'living',    '#64748b', 340),
    ('Land Tax & Strata Fees',     'expense', 'living',    '#78716c', 350),
    ('Charitable Giving',          'expense', 'lifestyle', '#2dd4bf', 360),
    ('Gifts',                      'expense', 'lifestyle', '#ec4899', 370),
    ('Electronics',                'expense', 'lifestyle', '#0ea5e9', 380),
    ('Beauty & Well-being',        'expense', 'lifestyle', '#f0abfc', 390),
    ('Office Expenses',            'expense', 'living',    '#a8a29e', 400),
    ('Hobbies',                    'expense', 'lifestyle', '#c4b5fd', 410),
    ('Travel/Holidays',            'expense', 'lifestyle', '#14b8a6', 420),
    ('Furniture & Homeware',       'expense', 'lifestyle', '#d8b4fe', 430),
    ('Buy Now Pay Later',          'expense', 'lifestyle', '#fda4af', 440),
    ('Services/Supplies',          'expense', 'living',    '#9ca3af', 450),
    ('Postage/Shipping',           'expense', 'living',    '#a1a1aa', 460),
    ('Business Miscellaneous',     'expense', 'living',    '#737373', 470)
ON CONFLICT (name) DO NOTHING;
