import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

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
    // Verify ownership
    const property = await prisma.property.findFirst({
      where: { id: propertyId, ownerId: user.id },
    });

    if (!property) {
      res.status(403).json({ error: 'Property not found or unauthorized' });
      return;
    }

    const lease = await prisma.lease.create({
      data: {
        propertyId,
        tenantId,
        rentAmount,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: status || 'active',
      },
      include: {
        property: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true } },
      },
    });

    // Auto-generate 3 payment rows for the new lease
    const now = new Date();
    const dueDates = [
      new Date(now.getFullYear(), now.getMonth(), 1),
      new Date(now.getFullYear(), now.getMonth() + 1, 1),
      new Date(now.getFullYear(), now.getMonth() + 2, 1),
    ];

    await prisma.payment.createMany({
      data: dueDates.map((d) => ({
        leaseId: lease.id,
        amount: rentAmount,
        dueDate: d,
        status: 'pending',
      })),
    });

    res.status(201).json({ ...lease, rentAmount: Number(lease.rentAmount) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create lease' });
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
  const { rentAmount, startDate, endDate, status } = req.body;

  try {
    const existing = await prisma.lease.findFirst({
      where: { id, property: { ownerId: user.id } },
    });

    if (!existing) {
      res.status(404).json({ error: 'Lease not found' });
      return;
    }

    const lease = await prisma.lease.update({
      where: { id },
      data: {
        ...(rentAmount !== undefined ? { rentAmount } : {}),
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        ...(endDate ? { endDate: new Date(endDate) } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        property: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true } },
      },
    });

    res.json({ ...lease, rentAmount: Number(lease.rentAmount) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update lease' });
  }
});

export default router;
