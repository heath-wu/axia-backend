import { Router, Response } from 'express';
import { getCachedValue, invalidateOwnerCache, setCachedValue } from '../lib/demo-cache';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { normalizeLeaseStatus } from '../lib/lease-validation';

const router = Router();

function leasePriority(status: string) {
  switch (status) {
    case 'active':
      return 0;
    case 'signed':
      return 1;
    case 'pending':
      return 2;
    case 'expired':
      return 3;
    case 'closed':
    default:
      return 4;
  }
}

// GET /tenants — list all tenants
router.get('/', async (req, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const cacheKey = `${user.id}:tenants`;
  try {
    const cached = getCachedValue(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const tenants = await prisma.tenant.findMany({
      where: { ownerId: user.id },
      include: {
        leases: {
          include: { property: { select: { name: true } } },
          orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = tenants.map((t) => {
      const leases = t.leases
        .map((lease) => ({
          ...lease,
          normalizedStatus: normalizeLeaseStatus(lease.status, lease.startDate, lease.endDate),
        }))
        .sort((a, b) => leasePriority(a.normalizedStatus) - leasePriority(b.normalizedStatus));
      const primaryLease = leases[0];

      return {
        id: t.id,
        name: t.name,
        email: t.email,
        phone: t.phone,
        createdAt: t.createdAt,
        status: primaryLease?.normalizedStatus || 'inactive',
        activeLease: primaryLease
          ? {
              id: primaryLease.id,
              rentAmount: Number(primaryLease.rentAmount),
              propertyName: primaryLease.property.name,
              status: primaryLease.normalizedStatus,
            }
          : null,
      };
    });

    setCachedValue(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch residents' });
  }
});

// POST /tenants — create a tenant
router.post('/', async (req, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { name, email, phone } = req.body;

  if (!name || !email) {
    res.status(400).json({ error: 'name and email are required' });
    return;
  }

  try {
    const tenant = await prisma.tenant.create({
      data: { ownerId: user.id, name, email, phone: phone || null },
    });
    invalidateOwnerCache(user.id);
    res.status(201).json(tenant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create resident' });
  }
});

// GET /tenants/:id
router.get('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;

  try {
    const tenant = await prisma.tenant.findFirst({
      where: { id, ownerId: user.id },
      include: {
        leases: {
          include: {
            property: true,
            payments: { orderBy: { dueDate: 'desc' }, take: 6 },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!tenant) {
      res.status(404).json({ error: 'Resident not found' });
      return;
    }

    res.json({
      ...tenant,
      leases: tenant.leases.map((lease) => ({
        ...lease,
        rentAmount: Number(lease.rentAmount),
        status: normalizeLeaseStatus(lease.status, lease.startDate, lease.endDate),
        payments: lease.payments.map((payment) => ({
          ...payment,
          amount: Number(payment.amount),
        })),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch resident' });
  }
});

// PUT /tenants/:id
router.put('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;
  const { name, email, phone } = req.body;

  try {
    const existing = await prisma.tenant.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Resident not found' });
      return;
    }

    const tenant = await prisma.tenant.update({
      where: { id },
      data: { name, email, phone: phone || null },
    });
    invalidateOwnerCache(user.id);
    res.json(tenant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update resident' });
  }
});

// DELETE /tenants/:id
router.delete('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;

  try {
    const existing = await prisma.tenant.findFirst({ where: { id, ownerId: user.id } });
    if (!existing) {
      res.status(404).json({ error: 'Resident not found' });
      return;
    }

    const leaseCount = await prisma.lease.count({
      where: { tenantId: id },
    });

    if (leaseCount > 0) {
      res.status(400).json({ error: 'Cannot delete resident with existing leases' });
      return;
    }

    await prisma.tenant.delete({ where: { id } });
    invalidateOwnerCache(user.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete resident' });
  }
});

export default router;
