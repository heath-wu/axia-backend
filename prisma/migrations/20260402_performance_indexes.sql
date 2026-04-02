CREATE INDEX IF NOT EXISTS properties_owner_id_created_at_idx
ON properties (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS leases_property_id_created_at_idx
ON leases (property_id, created_at DESC);

CREATE INDEX IF NOT EXISTS leases_property_id_start_date_end_date_idx
ON leases (property_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS leases_tenant_id_created_at_idx
ON leases (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_lease_id_due_date_idx
ON payments (lease_id, due_date);

CREATE INDEX IF NOT EXISTS payments_lease_id_created_at_idx
ON payments (lease_id, created_at DESC);
