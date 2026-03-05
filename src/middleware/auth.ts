import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

interface JwtPayload {
  sub: string;
  email: string;
  aud: string;
  role?: string;
}

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET!) as JwtPayload;

    const user = await prisma.user.upsert({
      where: { id: payload.sub },
      update: {},
      create: {
        id: payload.sub,
        email: payload.email,
      },
    });

    (req as AuthenticatedRequest).user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
