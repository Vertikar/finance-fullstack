-- Seed script: inserts a test user and 19 sample entries.
-- Idempotent — safe to run multiple times.
-- Usage: make seed
-- Login: test@example.com / testpassword

INSERT INTO users (id, email, password_hash)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'test@example.com',
    '$2a$10$UTZnN.H3UI9tHOuWWn3I3OTjpkGFJYSqOknt5FCtaoqbiCja1.p66'
)
ON CONFLICT DO NOTHING;

INSERT INTO entries (id, user_id, name, amount, type, frequency, category, next_due) VALUES
    ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Disney Plus',                   20.99,  'expense', 'monthly',    'Entertainment', '2026-06-26'),
    ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Netflix',                       20.99,  'expense', 'monthly',    'Entertainment', '2026-06-24'),
    ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Health Insurance',             150.00,  'expense', 'monthly',    'Health',        '2026-06-18'),
    ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Home Insurance',               355.00,  'expense', 'monthly',    'Housing',       '2026-06-23'),
    ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Home loan',                   3720.00,  'expense', 'monthly',    'Housing',       '2026-05-27'),
    ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Water Bill',                   250.00,  'expense', 'quarterly',  'Housing',       '2026-06-03'),
    ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'Council Rates',                600.00,  'expense', 'quarterly',  'Housing',       '2026-08-27'),
    ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', 'Swimming',                     190.00,  'expense', 'monthly',    'Other',         '2026-07-01'),
    ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', 'Childcare',                    220.00,  'expense', 'weekly',     'Other',         '2026-05-28'),
    ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Google Subscription',           45.00,  'expense', 'yearly',     'Subscriptions', '2027-05-13'),
    ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'Car Insurance',                180.00,  'expense', 'monthly',    'Transport',     '2026-06-07'),
    ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'Car Service',                  600.00,  'expense', 'biannual',   'Transport',     '2026-06-24'),
    ('10000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'Car Registration',             440.00,  'expense', 'biannual',   'Transport',     '2026-11-26'),
    ('10000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', 'Password Manger Subscription',  95.00,  'expense', 'yearly',     'Utilities',     '2026-06-20'),
    ('10000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000001', 'Internet',                      90.00,  'expense', 'monthly',    'Utilities',     '2026-06-18'),
    ('10000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000001', 'Gas',                           55.00,  'expense', 'monthly',    'Utilities',     '2026-07-15'),
    ('10000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000001', 'Power Bill',                   175.00,  'expense', 'monthly',    'Utilities',     '2026-06-30'),
    ('10000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-000000000001', 'Mobile Phone',                  85.00,  'expense', 'monthly',    'Utilities',     '2026-06-21'),
    ('10000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-000000000001', 'Salary',                     15000.00,  'income',  'monthly',    'Salary',        '2026-06-14')
ON CONFLICT DO NOTHING;
