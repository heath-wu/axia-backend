import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /dashboard — aggregated summary stats
router.get('/', async (req, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const ownerId = user.id;

  try {
    const [propertyCount, activeLeaseCount, overdueCount, recentLeases] =
      await prisma.$transaction([
        prisma.property.count({ where: { ownerId } }),
        prisma.lease.count({ where: { property: { ownerId }, status: 'active' } }),
        prisma.payment.count({
          where: { status: 'overdue', lease: { property: { ownerId } } },
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

    const totalMonthlyRent = await prisma.lease.aggregate({
      _sum: { rentAmount: true },
      where: { property: { ownerId }, status: 'active' },
    });

    res.json({
      totalProperties: propertyCount,
      activeLeases: activeLeaseCount,
      overduePayments: overdueCount,
      totalMonthlyRent: Number(totalMonthlyRent._sum.rentAmount || 0),
      recentLeases: recentLeases.map((l) => ({
        id: l.id,
        propertyName: l.property.name,
        tenantName: l.tenant.name,
        rentAmount: Number(l.rentAmount),
        status: l.status,
        startDate: l.startDate,
        endDate: l.endDate,
        createdAt: l.createdAt,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

export default router;
