import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /tenants — list all tenants
router.get('/', async (_req, res: Response) => {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        leases: {
          where: { status: 'active' },
          include: { property: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = tenants.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      phone: t.phone,
      createdAt: t.createdAt,
      activeLease: t.leases[0]
        ? {
            id: t.leases[0].id,
            rentAmount: Number(t.leases[0].rentAmount),
            propertyName: t.leases[0].property.name,
            status: t.leases[0].status,
          }
        : null,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

// POST /tenants — create a tenant
router.post('/', async (req, res: Response) => {
  const { name, email, phone } = req.body;

  if (!name || !email) {
    res.status(400).json({ error: 'name and email are required' });
    return;
  }

  try {
    const tenant = await prisma.tenant.create({
      data: { name, email, phone: phone || null },
    });
    res.status(201).json(tenant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});

// GET /tenants/:id
router.get('/:id', async (req, res: Response) => {
  const { id } = req.params;

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
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
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    res.json(tenant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch tenant' });
  }
});

// PUT /tenants/:id
router.put('/:id', async (req, res: Response) => {
  const { id } = req.params;
  const { name, email, phone } = req.body;

  try {
    const tenant = await prisma.tenant.update({
      where: { id },
      data: { name, email, phone: phone || null },
    });
    res.json(tenant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update tenant' });
  }
});

export default router;
