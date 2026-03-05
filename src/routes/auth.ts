import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

const router = Router();

function verifyToken(req: Request): { sub: string; email: string } | null {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.SUPABASE_JWT_SECRET!) as { sub: string; email: string };
  } catch {
    return null;
  }
}

// GET /auth/me
router.get('/me', async (req: Request, res: Response) => {
  const payload = verifyToken(req);
  if (!payload) { res.status(401).json({ error: 'Unauthorized' }); return; }
  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// POST /auth/logout — JWT is stateless; client clears the token. This just acknowledges.
router.post('/logout', (_req: Request, res: Response) => {
  res.json({ success: true });
});

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  // Demo: single hardcoded credential check
  if (email !== 'demo@axia.com' || password !== 'AxiaDemo2024!') {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'User not found — run npm run db:seed first' });
      return;
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.SUPABASE_JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({
      access_token: token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
