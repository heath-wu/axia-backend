import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /properties — list all properties for the authenticated user
router.get('/', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  try {
    const properties = await prisma.property.findMany({
      where: { ownerId: user.id },
      include: {
        leases: {
          where: { status: 'active' },
          select: { rentAmount: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = properties.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      createdAt: p.createdAt,
      leaseCount: p.leases.length,
      monthlyIncome: p.leases.reduce(
        (sum, l) => sum + Number(l.rentAmount),
        0
      ),
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

// POST /properties — create a new property
router.post('/', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { name, address } = req.body;

  if (!name || !address) {
    res.status(400).json({ error: 'name and address are required' });
    return;
  }

  try {
    const property = await prisma.property.create({
      data: { name, address, ownerId: user.id },
    });
    res.status(201).json(property);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create property' });
  }
});

// GET /properties/:id — get a single property with its leases
router.get('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;

  try {
    const property = await prisma.property.findFirst({
      where: { id, ownerId: user.id },
      include: {
        leases: {
          include: { tenant: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!property) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    res.json(property);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch property' });
  }
});

// PUT /properties/:id — update a property
router.put('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;
  const { name, address } = req.body;

  try {
    const existing = await prisma.property.findFirst({
      where: { id, ownerId: user.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    const property = await prisma.property.update({
      where: { id },
      data: { name, address },
    });

    res.json(property);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update property' });
  }
});

// DELETE /properties/:id
router.delete('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;

  try {
    const existing = await prisma.property.findFirst({
      where: { id, ownerId: user.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    const leaseCount = await prisma.lease.count({
      where: { propertyId: id },
    });

    if (leaseCount > 0) {
      res.status(400).json({ error: 'Cannot delete property with existing leases' });
      return;
    }

    await prisma.property.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete property' });
  }
});

export default router;
