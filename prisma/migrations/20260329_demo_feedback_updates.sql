ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS special_terms TEXT,
  ADD COLUMN IF NOT EXISTS concessions TEXT,
  ADD COLUMN IF NOT EXISTS fees TEXT,
  ADD COLUMN IF NOT EXISTS lease_document_url TEXT;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS paid_at DATE;

DO $$
BEGIN
  UPDATE leases
  SET status = 'pending'
  WHERE status IS NULL;

  UPDATE payments
  SET status = CASE
    WHEN paid_at IS NOT NULL AND paid_at > due_date THEN 'late_paid'
    WHEN paid_at IS NOT NULL THEN 'paid'
    WHEN due_date < CURRENT_DATE THEN 'late_unpaid'
    ELSE 'upcoming'
  END
  WHERE status IS NULL
     OR status IN ('pending', 'overdue');

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leases_valid_status'
  ) THEN
    ALTER TABLE leases DROP CONSTRAINT leases_valid_status;
  END IF;

  ALTER TABLE leases
    ADD CONSTRAINT leases_valid_status
    CHECK (status IN ('pending', 'signed', 'active', 'expired', 'closed'));
END $$;
