import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function applyConstraints() {
  console.log('Applying DB constraints...');

  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS btree_gist`);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leases_start_before_end') THEN
        ALTER TABLE leases
        ADD CONSTRAINT leases_start_before_end
        CHECK (start_date < end_date);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leases_positive_rent') THEN
        ALTER TABLE leases
        ADD CONSTRAINT leases_positive_rent
        CHECK (rent_amount > 0);
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leases_valid_status') THEN
        ALTER TABLE leases
        ADD CONSTRAINT leases_valid_status
        CHECK (status IN ('pending', 'active', 'expired', 'closed'));
      END IF;
    END
    $$;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION enforce_lease_write_rules()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.start_date >= NEW.end_date THEN
        RAISE EXCEPTION 'Lease start_date must be before end_date.'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.rent_amount <= 0 THEN
        RAISE EXCEPTION 'Lease rent_amount must be greater than 0.'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.status = 'active' AND (CURRENT_DATE < NEW.start_date OR CURRENT_DATE >= NEW.end_date) THEN
        RAISE EXCEPTION 'Lease cannot be active outside its active window.'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.status = 'expired' AND CURRENT_DATE < NEW.end_date THEN
        RAISE EXCEPTION 'Lease cannot be expired before end_date.'
          USING ERRCODE = '23514';
      END IF;

      IF NEW.status = 'pending' AND CURRENT_DATE >= NEW.end_date THEN
        RAISE EXCEPTION 'Lease cannot be pending on/after end_date.'
          USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $$;
  `);

  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS trg_enforce_lease_active_start_date ON leases;
  `);
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS trg_enforce_lease_write_rules ON leases;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER trg_enforce_lease_write_rules
    BEFORE INSERT OR UPDATE OF status, start_date, end_date, rent_amount
    ON leases
    FOR EACH ROW
    EXECUTE FUNCTION enforce_lease_write_rules();
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leases_no_overlap_per_property') THEN
        ALTER TABLE leases
        ADD CONSTRAINT leases_no_overlap_per_property
        EXCLUDE USING gist (
          property_id WITH =,
          daterange(start_date, end_date, '[)') WITH &&
        )
        WHERE (status <> 'closed');
      END IF;
    END
    $$;
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE tenants
    ALTER COLUMN owner_id SET NOT NULL
  `);

  console.log('DB constraints applied.');
}

applyConstraints()
  .catch((e) => {
    console.error('Failed to apply DB constraints:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
