import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  deriveLeaseStatus,
  isValidDate,
  validateStatusForDates,
  toDateKey,
} from '../lib/lease-validation';

const router = Router();

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function generateMonthlyDueDates(startDate: Date, endDate: Date) {
  const dueDates: Date[] = [];
  let cursor = startOfMonth(startDate);

  while (cursor < endDate) {
    dueDates.push(new Date(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return dueDates;
}

function getInitialPaymentStatus(dueDate: Date, now = new Date()) {
  const dueKey = dueDate.toISOString().slice(0, 10);
  const todayKey = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10);
  return dueKey < todayKey ? 'overdue' : 'pending';
}

async function hasPropertyOverlap(
  propertyId: string,
  startDate: Date,
  endDate: Date,
  excludeLeaseId?: string
) {
  const overlaps = await prisma.lease.findFirst({
    where: {
      propertyId,
      status: { not: 'closed' },
      ...(excludeLeaseId ? { id: { not: excludeLeaseId } } : {}),
      startDate: { lt: endDate },
      endDate: { gt: startDate },
    },
    select: { id: true },
  });

  return !!overlaps;
}

function handleLeaseWriteError(err: unknown, res: Response, fallbackMessage: string) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const message = String(err.meta?.message || err.message);
    if (message.includes('leases_no_overlap_per_property')) {
      res.status(409).json({ error: 'Property already has a lease in this date range' });
      return true;
    }
  }

  console.error(err);
  res.status(500).json({ error: fallbackMessage });
  return true;
}

// GET /leases — list all leases for authenticated user's properties
router.get('/', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { property_id, tenant_id } = req.query;

  try {
    const leases = await prisma.lease.findMany({
      where: {
        property: { ownerId: user.id },
        ...(property_id ? { propertyId: property_id as string } : {}),
        ...(tenant_id ? { tenantId: tenant_id as string } : {}),
      },
      include: {
        property: { select: { id: true, name: true, address: true } },
        tenant: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(leases.map((l) => ({ ...l, rentAmount: Number(l.rentAmount) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch leases' });
  }
});

// POST /leases — create a lease
router.post('/', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { propertyId, tenantId, rentAmount, startDate, endDate, status } = req.body;

  if (!propertyId || !tenantId || !rentAmount || !startDate || !endDate) {
    res.status(400).json({ error: 'propertyId, tenantId, rentAmount, startDate, endDate are required' });
    return;
  }

  try {
    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);
    const rent = Number(rentAmount);

    if (!isValidDate(parsedStartDate) || !isValidDate(parsedEndDate)) {
      res.status(400).json({ error: 'startDate and endDate must be valid dates' });
      return;
    }
    if (!(rent > 0)) {
      res.status(400).json({ error: 'rentAmount must be greater than 0' });
      return;
    }
    if (toDateKey(parsedStartDate) >= toDateKey(parsedEndDate)) {
      res.status(400).json({ error: 'startDate must be before endDate' });
      return;
    }

    const nextStatus = status ?? deriveLeaseStatus(parsedStartDate, parsedEndDate);
    const statusError = validateStatusForDates(nextStatus, parsedStartDate, parsedEndDate);
    if (statusError) {
      res.status(400).json({ error: statusError });
      return;
    }

    // Verify ownership
    const [property, tenant] = await Promise.all([
      prisma.property.findFirst({
        where: { id: propertyId, ownerId: user.id },
        select: { id: true },
      }),
      prisma.tenant.findFirst({
        where: { id: tenantId, ownerId: user.id },
        select: { id: true },
      }),
    ]);

    if (!property) {
      res.status(403).json({ error: 'Property not found or unauthorized' });
      return;
    }
    if (!tenant) {
      res.status(403).json({ error: 'Tenant not found or unauthorized' });
      return;
    }

    const overlapsExisting = await hasPropertyOverlap(propertyId, parsedStartDate, parsedEndDate);
    if (overlapsExisting) {
      res.status(409).json({ error: 'Property already has a lease in this date range' });
      return;
    }

    const lease = await prisma.lease.create({
      data: {
        propertyId,
        tenantId,
        rentAmount: rent,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        status: nextStatus,
      },
      include: {
        property: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true } },
      },
    });

    // Auto-generate monthly payment rows for the entire lease term.
    const dueDates = generateMonthlyDueDates(lease.startDate, lease.endDate);

    if (dueDates.length > 0) {
      await prisma.payment.createMany({
        data: dueDates.map((d) => ({
          leaseId: lease.id,
          amount: rent,
          dueDate: d,
          status: getInitialPaymentStatus(d),
        })),
      });
    }

    res.status(201).json({ ...lease, rentAmount: Number(lease.rentAmount) });
  } catch (err) {
    handleLeaseWriteError(err, res, 'Failed to create lease');
  }
});

// GET /leases/:id
router.get('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;

  try {
    const lease = await prisma.lease.findFirst({
      where: { id, property: { ownerId: user.id } },
      include: {
        property: true,
        tenant: true,
        payments: { orderBy: { dueDate: 'asc' } },
      },
    });

    if (!lease) {
      res.status(404).json({ error: 'Lease not found' });
      return;
    }

    res.json({
      ...lease,
      rentAmount: Number(lease.rentAmount),
      payments: lease.payments.map((p) => ({
        ...p,
        amount: Number(p.amount),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch lease' });
  }
});

// PUT /leases/:id
router.put('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;
  const { propertyId, tenantId, rentAmount, startDate, endDate, status } = req.body;

  try {
    const existing = await prisma.lease.findFirst({
      where: { id, property: { ownerId: user.id } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Lease not found' });
      return;
    }

    const nextPropertyId = propertyId ?? existing.propertyId;
    const nextTenantId = tenantId ?? existing.tenantId;
    const nextStartDate = startDate ? new Date(startDate) : existing.startDate;
    let nextEndDate = endDate ? new Date(endDate) : existing.endDate;
    const nextRentAmount = rentAmount !== undefined ? Number(rentAmount) : Number(existing.rentAmount);

    if (!isValidDate(nextStartDate) || !isValidDate(nextEndDate)) {
      res.status(400).json({ error: 'startDate and endDate must be valid dates' });
      return;
    }
    if (!(nextRentAmount > 0)) {
      res.status(400).json({ error: 'rentAmount must be greater than 0' });
      return;
    }

    const closingNow = status === 'closed' && existing.status !== 'closed';
    if (closingNow) {
      const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
      if (toDateKey(today) < toDateKey(nextEndDate)) {
        nextEndDate = today;
      }
    }

    if (toDateKey(nextStartDate) >= toDateKey(nextEndDate)) {
      res.status(400).json({ error: 'startDate must be before endDate' });
      return;
    }

    const nextStatus = status ?? (startDate || endDate ? deriveLeaseStatus(nextStartDate, nextEndDate) : existing.status);
    const statusError = validateStatusForDates(nextStatus, nextStartDate, nextEndDate);
    if (statusError) {
      res.status(400).json({ error: statusError });
      return;
    }

    const [property, tenant] = await Promise.all([
      prisma.property.findFirst({
        where: { id: nextPropertyId, ownerId: user.id },
        select: { id: true },
      }),
      prisma.tenant.findFirst({
        where: { id: nextTenantId, ownerId: user.id },
        select: { id: true },
      }),
    ]);

    if (!property) {
      res.status(403).json({ error: 'Property not found or unauthorized' });
      return;
    }
    if (!tenant) {
      res.status(403).json({ error: 'Tenant not found or unauthorized' });
      return;
    }

    const overlapsExisting = await hasPropertyOverlap(nextPropertyId, nextStartDate, nextEndDate, id);
    if (overlapsExisting) {
      res.status(409).json({ error: 'Property already has a lease in this date range' });
      return;
    }

    const lease = await prisma.lease.update({
      where: { id },
      data: {
        propertyId: nextPropertyId,
        tenantId: nextTenantId,
        rentAmount: nextRentAmount,
        startDate: nextStartDate,
        endDate: nextEndDate,
        status: nextStatus,
      },
      include: {
        property: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true } },
      },
    });

    // Sync pending payments to new rent amount (paid/overdue keep their original amount)
    if (rentAmount !== undefined || status === 'closed') {
      await prisma.payment.updateMany({
        where: { leaseId: id, status: 'pending' },
        data: {
          ...(rentAmount !== undefined ? { amount: nextRentAmount } : {}),
          ...(status === 'closed' ? { status: 'expired' } : {}),
        },
      });
    }

    res.json({ ...lease, rentAmount: Number(lease.rentAmount) });
  } catch (err) {
    handleLeaseWriteError(err, res, 'Failed to update lease');
  }
});

// DELETE /leases/:id
router.delete('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;

  try {
    const existing = await prisma.lease.findFirst({
      where: { id, property: { ownerId: user.id } },
      select: { id: true },
    });

    if (!existing) {
      res.status(404).json({ error: 'Lease not found' });
      return;
    }

    await prisma.$transaction([
      prisma.payment.deleteMany({ where: { leaseId: id } }),
      prisma.lease.delete({ where: { id } }),
    ]);

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete lease' });
  }
});

export default router;
