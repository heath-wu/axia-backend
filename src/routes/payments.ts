import { Router, Response } from 'express';
import { getCachedValue, invalidateOwnerCache, setCachedValue } from '../lib/demo-cache';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { derivePaymentStatus, normalizePaymentStatus } from '../lib/payment-status';

const router = Router();

router.get('/', async (req, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { lease_id, status } = req.query;
  const cacheKey = `${user.id}:payments:${String(lease_id || '')}:${String(status || '')}`;

  try {
    const cached = getCachedValue(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    if (lease_id) {
      const lease = await prisma.lease.findFirst({
        where: { id: lease_id as string, property: { ownerId: user.id } },
      });

      if (!lease) {
        res.status(404).json({ error: 'Lease not found' });
        return;
      }
    }

    const payments = await prisma.payment.findMany({
      where: {
        lease: {
          property: { ownerId: user.id },
          ...(lease_id ? { id: lease_id as string } : {}),
        },
      },
      include: {
        lease: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            property: { select: { id: true, name: true } },
            tenant: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });

    const normalized = payments.map((payment) => ({
      ...payment,
      amount: Number(payment.amount),
      status: normalizePaymentStatus(payment),
    }));

    const filtered = typeof status === 'string'
      ? normalized.filter((payment) => payment.status === status)
      : normalized;

    setCachedValue(cacheKey, filtered);
    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

router.post('/simulate', async (req, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { paymentId } = req.body;

  if (!paymentId) {
    res.status(400).json({ error: 'paymentId is required' });
    return;
  }

  try {
    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, lease: { property: { ownerId: user.id } } },
    });

    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    const paidAt = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
    );

    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        paidAt,
        status: derivePaymentStatus(payment.dueDate, paidAt),
      },
    });

    invalidateOwnerCache(user.id);
    res.json({
      ...updated,
      amount: Number(updated.amount),
      status: normalizePaymentStatus(updated),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to simulate payment' });
  }
});

export default router;
