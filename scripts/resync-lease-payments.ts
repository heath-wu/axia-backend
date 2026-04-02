import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { syncLeasePayments } from '../src/lib/sync-lease-payments';

async function main() {
  const leaseId = process.argv[2];

  const leases = await prisma.lease.findMany({
    where: leaseId ? { id: leaseId } : undefined,
    select: {
      id: true,
      rentAmount: true,
      startDate: true,
      endDate: true,
      tenant: { select: { name: true } },
      property: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (leases.length === 0) {
    throw new Error(leaseId ? `Lease ${leaseId} not found` : 'No leases found to resync');
  }

  for (const lease of leases) {
    await syncLeasePayments(
      lease.id,
      lease.startDate,
      lease.endDate,
      Number(lease.rentAmount)
    );

    console.log(
      `Resynced ${lease.id} | ${lease.property.name} | ${lease.tenant.name} | ${lease.startDate.toISOString().slice(0, 10)}`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
