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

async function backfillTenantOwnership() {
  console.log('Backfilling tenant ownership...');

  const ambiguous = await prisma.$queryRawUnsafe<
    Array<{ tenant_id: string; owners: string[]; owner_count: bigint }>
  >(`
    SELECT
      l.tenant_id,
      ARRAY_AGG(DISTINCT p.owner_id) AS owners,
      COUNT(DISTINCT p.owner_id) AS owner_count
    FROM leases l
    JOIN properties p ON p.id = l.property_id
    GROUP BY l.tenant_id
    HAVING COUNT(DISTINCT p.owner_id) > 1
  `);

  if (ambiguous.length > 0) {
    const ids = ambiguous.map((a) => a.tenant_id).join(', ');
    throw new Error(`Cannot backfill tenants with multiple owners. Tenant ids: ${ids}`);
  }

  await prisma.$executeRawUnsafe(`
    UPDATE tenants t
    SET owner_id = src.owner_id
    FROM (
      SELECT
        l.tenant_id,
        MIN(p.owner_id) AS owner_id,
        COUNT(DISTINCT p.owner_id) AS owner_count
      FROM leases l
      JOIN properties p ON p.id = l.property_id
      GROUP BY l.tenant_id
    ) src
    WHERE t.id = src.tenant_id
      AND t.owner_id IS NULL
      AND src.owner_count = 1
  `);

  const fallbackUser =
    (
      await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM users WHERE email = 'demo@axia.com' LIMIT 1`
      )
    )[0] ??
    (
      await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM users ORDER BY created_at ASC LIMIT 1`
      )
    )[0];

  const orphanCount = await prisma.tenant.count({ where: { ownerId: null } });
  if (orphanCount === 0) {
    console.log('No unowned tenants found. Backfill skipped.');
    return;
  }

  if (!fallbackUser) {
    throw new Error('No user available to assign orphan tenants');
  }

  await prisma.tenant.updateMany({
    where: { ownerId: null },
    data: { ownerId: fallbackUser.id },
  });

  const remaining = await prisma.tenant.count({ where: { ownerId: null } });
  if (remaining > 0) {
    throw new Error(`Tenant owner backfill incomplete. ${remaining} tenants still unowned.`);
  }

  console.log('Tenant ownership backfill complete.');
}

backfillTenantOwnership()
  .catch((e) => {
    console.error('Failed to backfill tenant ownership:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
