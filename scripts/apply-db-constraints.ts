import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function applyConstraints() {
  console.log('Applying DB constraints...');

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION enforce_lease_active_start_date()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.status = 'active' AND NEW.start_date > CURRENT_DATE THEN
        RAISE EXCEPTION 'Lease cannot be active before start_date (%).', NEW.start_date
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
    CREATE TRIGGER trg_enforce_lease_active_start_date
    BEFORE INSERT OR UPDATE OF status, start_date
    ON leases
    FOR EACH ROW
    EXECUTE FUNCTION enforce_lease_active_start_date();
  `);

  console.log('DB constraints applied.');
}

applyConstraints()
  .catch((e) => {
    console.error('Failed to apply DB constraints:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
