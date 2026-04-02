import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { getCachedValue, invalidateOwnerCache, setCachedValue } from '../lib/demo-cache';
import { prisma } from '../lib/prisma';
import { syncLeasePayments } from '../lib/sync-lease-payments';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  isValidDate,
  normalizeLeaseStatus,
  toDateKey,
  validateStatusForDates,
} from '../lib/lease-validation';
import { normalizePaymentStatus } from '../lib/payment-status';

const router = Router();

function cleanOptionalText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanOptionalUrl(value: unknown) {
  const trimmed = cleanOptionalText(value);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function mapLease(lease: {
  rentAmount: Prisma.Decimal;
  startDate: Date;
  endDate: Date;
  status: string;
  payments?: Array<{
    amount: Prisma.Decimal;
    dueDate: Date;
    status: string;
    paidAt: Date | null;
  }>;
  [key: string]: unknown;
}) {
  return {
    ...lease,
    rentAmount: Number(lease.rentAmount),
    status: normalizeLeaseStatus(lease.status, lease.startDate, lease.endDate),
    payments: lease.payments?.map((payment) => ({
      ...payment,
      amount: Number(payment.amount),
      status: normalizePaymentStatus(payment),
    })),
  };
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

router.get('/', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { property_id, tenant_id } = req.query;
  const cacheKey = `${user.id}:leases:${String(property_id || '')}:${String(tenant_id || '')}`;

  try {
    const cached = getCachedValue(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const leases = await prisma.lease.findMany({
      where: {
        property: { ownerId: user.id },
        ...(property_id ? { propertyId: property_id as string } : {}),
        ...(tenant_id ? { tenantId: tenant_id as string } : {}),
      },
      include: {
        property: { select: { id: true, name: true, address: true, imageUrl: true } },
        tenant: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const payload = leases.map((lease) => mapLease(lease));
    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch leases' });
  }
});

router.post('/', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const {
    propertyId,
    tenantId,
    rentAmount,
    startDate,
    endDate,
    specialTerms,
    concessions,
    fees,
    leaseDocumentUrl,
    status,
  } = req.body;

  if (
    !propertyId ||
    !tenantId ||
    rentAmount === undefined ||
    rentAmount === null ||
    !startDate ||
    !endDate
  ) {
    res.status(400).json({ error: 'propertyId, tenantId, rentAmount, startDate, endDate are required' });
    return;
  }

  try {
    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);
    const rent = Number(rentAmount);
    const nextStatus = typeof status === 'string' ? status : 'pending';

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

    const statusError = validateStatusForDates(nextStatus, parsedStartDate, parsedEndDate);
    if (statusError) {
      res.status(400).json({ error: statusError });
      return;
    }

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
      res.status(403).json({ error: 'Resident not found or unauthorized' });
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
        specialTerms: cleanOptionalText(specialTerms),
        concessions: cleanOptionalText(concessions),
        fees: cleanOptionalText(fees),
        leaseDocumentUrl: cleanOptionalUrl(leaseDocumentUrl),
      },
      include: {
        property: { select: { id: true, name: true, address: true, imageUrl: true } },
        tenant: { select: { id: true, name: true, email: true } },
      },
    });

    await syncLeasePayments(lease.id, lease.startDate, lease.endDate, rent);

    invalidateOwnerCache(user.id);
    res.status(201).json(mapLease(lease));
  } catch (err) {
    handleLeaseWriteError(err, res, 'Failed to create lease');
  }
});

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

    res.json(mapLease(lease));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch lease' });
  }
});

router.put('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;
  const {
    propertyId,
    tenantId,
    rentAmount,
    startDate,
    endDate,
    status,
    specialTerms,
    concessions,
    fees,
    leaseDocumentUrl,
  } = req.body;

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
      const today = new Date(
        Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
      );
      if (toDateKey(today) < toDateKey(nextEndDate)) {
        nextEndDate = today;
      }
    }

    if (toDateKey(nextStartDate) >= toDateKey(nextEndDate)) {
      res.status(400).json({ error: 'startDate must be before endDate' });
      return;
    }

    const nextStatus = status ?? existing.status;
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
      res.status(403).json({ error: 'Resident not found or unauthorized' });
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
        specialTerms: specialTerms !== undefined ? cleanOptionalText(specialTerms) : undefined,
        concessions: concessions !== undefined ? cleanOptionalText(concessions) : undefined,
        fees: fees !== undefined ? cleanOptionalText(fees) : undefined,
        leaseDocumentUrl:
          leaseDocumentUrl !== undefined ? cleanOptionalUrl(leaseDocumentUrl) : undefined,
      },
      include: {
        property: { select: { id: true, name: true, address: true, imageUrl: true } },
        tenant: { select: { id: true, name: true, email: true } },
      },
    });

    await syncLeasePayments(lease.id, nextStartDate, nextEndDate, nextRentAmount);

    invalidateOwnerCache(user.id);
    res.json(mapLease(lease));
  } catch (err) {
    handleLeaseWriteError(err, res, 'Failed to update lease');
  }
});

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

    invalidateOwnerCache(user.id);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete lease' });
  }
});

export default router;
