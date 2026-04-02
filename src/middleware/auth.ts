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

type CachedUser = {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  expiresAt: number;
};

const USER_CACHE_TTL_MS = 5 * 60 * 1000;
const userCache = new Map<string, CachedUser>();

function getCachedUser(cacheKey: string) {
  const cached = userCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    userCache.delete(cacheKey);
    return null;
  }

  return cached.user;
}

function setCachedUser(cacheKey: string, user: AuthenticatedRequest['user']) {
  userCache.set(cacheKey, {
    user,
    expiresAt: Date.now() + USER_CACHE_TTL_MS,
  });
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
    const cacheKey = `${payload.sub}:${payload.email}`;
    const cachedUser = getCachedUser(cacheKey);

    if (cachedUser) {
      (req as AuthenticatedRequest).user = cachedUser;
      next();
      return;
    }

    let user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: payload.sub,
          email: payload.email,
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      });
    }

    setCachedUser(cacheKey, user);
    (req as AuthenticatedRequest).user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
