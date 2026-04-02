import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { authMiddleware } from './middleware/auth';
import authRouter from './routes/auth';
import propertiesRouter from './routes/properties';
import tenantsRouter from './routes/tenants';
import leasesRouter from './routes/leases';
import paymentsRouter from './routes/payments';
import dashboardRouter from './routes/dashboard';

dotenv.config();

const app = express();

app.use(
  cors({
    origin: [process.env.FRONTEND_URL || 'http://localhost:3000'],
    credentials: true,
  })
);
app.use(express.json({ limit: '3mb' }));

// Public routes (no auth required)
app.get('/', (_req, res) => {
  res.json({ service: 'axia-backend', status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/auth', authRouter);

// Auth middleware applied to all routes below
app.use(authMiddleware);

// Routes
app.use('/properties', propertiesRouter);
app.use('/tenants', tenantsRouter);
app.use('/leases', leasesRouter);
app.use('/payments', paymentsRouter);
app.use('/dashboard', dashboardRouter);

export default app;
