import { Router, Response } from 'express';
import { getCachedValue, invalidateOwnerCache, setCachedValue } from '../lib/demo-cache';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { normalizeLeaseStatus } from '../lib/lease-validation';

const router = Router();

// GET /properties — list all properties for the authenticated user
router.get('/', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const cacheKey = `${user.id}:properties`;
  try {
    const cached = getCachedValue(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const properties = await prisma.property.findMany({
      where: { ownerId: user.id },
      include: {
        leases: {
          select: { rentAmount: true, status: true, startDate: true, endDate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = properties.map((p) => {
      const activeLeases = p.leases.filter(
        (lease) => normalizeLeaseStatus(lease.status, lease.startDate, lease.endDate) === 'active'
      );

      return {
        id: p.id,
        name: p.name,
        address: p.address,
        imageUrl: p.imageUrl,
        createdAt: p.createdAt,
        leaseCount: activeLeases.length,
        monthlyIncome: activeLeases.reduce(
          (sum, l) => sum + Number(l.rentAmount),
          0
        ),
      };
    });

    setCachedValue(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

// POST /properties — create a new property
router.post('/', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { name, address, imageUrl } = req.body;

  if (!name || !address) {
    res.status(400).json({ error: 'name and address are required' });
    return;
  }

  try {
    const property = await prisma.property.create({
      data: { name, address, imageUrl: typeof imageUrl === 'string' ? imageUrl : null, ownerId: user.id },
    });
    invalidateOwnerCache(user.id);
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

    res.json({
      ...property,
      leases: property.leases.map((lease) => ({
        ...lease,
        rentAmount: Number(lease.rentAmount),
        status: normalizeLeaseStatus(lease.status, lease.startDate, lease.endDate),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch property' });
  }
});

// PUT /properties/:id — update a property
router.put('/:id', async (req, res: Response) => {
  const { user } = req as unknown as AuthenticatedRequest;
  const { id } = req.params;
  const { name, address, imageUrl } = req.body;

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
      data: { name, address, imageUrl: imageUrl === undefined ? undefined : imageUrl || null },
    });

    invalidateOwnerCache(user.id);
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
    invalidateOwnerCache(user.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete property' });
  }
});

export default router;
