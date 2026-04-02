import { Router, Response } from 'express';
import { getCachedValue, setCachedValue } from '../lib/demo-cache';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { normalizeLeaseStatus, toDateKey } from '../lib/lease-validation';

const router = Router();

// GET /dashboard — aggregated summary stats
router.get('/', async (req, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const ownerId = user.id;
  const cacheKey = `${ownerId}:dashboard`;

  try {
    const cached = getCachedValue(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const [propertyCount, leases, payments, recentLeases] =
      await prisma.$transaction([
        prisma.property.count({ where: { ownerId } }),
        prisma.lease.findMany({
          where: { property: { ownerId } },
          select: { id: true, status: true, startDate: true, endDate: true, rentAmount: true },
        }),
        prisma.payment.findMany({
          where: { lease: { property: { ownerId } } },
          select: { id: true, dueDate: true, paidAt: true },
        }),
        prisma.lease.findMany({
          where: { property: { ownerId } },
          include: {
            property: { select: { name: true } },
            tenant: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      ]);

    const activeLeaseCount = leases.filter((lease) =>
      normalizeLeaseStatus(lease.status, lease.startDate, lease.endDate) === 'active'
    ).length;
    const overdueCount = payments.filter(
      (payment) => !payment.paidAt && toDateKey(payment.dueDate) < toDateKey(new Date())
    ).length;
    const totalMonthlyRent = leases
      .filter((lease) => normalizeLeaseStatus(lease.status, lease.startDate, lease.endDate) === 'active')
      .reduce((sum, lease) => sum + Number(lease.rentAmount), 0);

    const payload = {
      totalProperties: propertyCount,
      activeLeases: activeLeaseCount,
      overduePayments: overdueCount,
      totalMonthlyRent,
      recentLeases: recentLeases.map((l) => ({
        id: l.id,
        propertyName: l.property.name,
        tenantName: l.tenant.name,
        rentAmount: Number(l.rentAmount),
        status: normalizeLeaseStatus(l.status, l.startDate, l.endDate),
        startDate: l.startDate,
        endDate: l.endDate,
        createdAt: l.createdAt,
      })),
    };

    setCachedValue(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

export default router;
