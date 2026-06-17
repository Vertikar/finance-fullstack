ALTER TABLE users
  ADD COLUMN pay_cycle     TEXT CHECK (pay_cycle IN ('fortnightly', 'monthly')),
  ADD COLUMN last_pay_date DATE;
