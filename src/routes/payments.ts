import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /payments?lease_id=:id — fetch payment history for a lease
router.get('/', async (req, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { lease_id } = req.query;

  if (!lease_id) {
    res.status(400).json({ error: 'lease_id query param is required' });
    return;
  }

  try {
    // Verify the lease belongs to this user
    const lease = await prisma.lease.findFirst({
      where: { id: lease_id as string, property: { ownerId: user.id } },
    });

    if (!lease) {
      res.status(404).json({ error: 'Lease not found' });
      return;
    }

    const payments = await prisma.payment.findMany({
      where: { leaseId: lease_id as string },
      orderBy: { dueDate: 'asc' },
    });

    res.json(payments.map((p) => ({ ...p, amount: Number(p.amount) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// POST /payments/simulate — mark a payment as paid
router.post('/simulate', async (req, res: Response) => {
  const { user } = req as AuthenticatedRequest;
  const { paymentId } = req.body;

  if (!paymentId) {
    res.status(400).json({ error: 'paymentId is required' });
    return;
  }

  try {
    // Verify the payment belongs to a lease owned by this user
    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, lease: { property: { ownerId: user.id } } },
    });

    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'paid' },
    });

    res.json({ ...updated, amount: Number(updated.amount) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to simulate payment' });
  }
});

export default router;
