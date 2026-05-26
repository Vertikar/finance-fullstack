ALTER TABLE entries DROP CONSTRAINT entries_frequency_check;
ALTER TABLE entries ADD CONSTRAINT entries_frequency_check
  CHECK (frequency IN ('weekly','fortnightly','monthly','quarterly','biannual','yearly'));
