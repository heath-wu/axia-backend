import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import { authMiddleware } from './middleware/auth';
import authRouter from './routes/auth';
import propertiesRouter from './routes/properties';
import tenantsRouter from './routes/tenants';
import leasesRouter from './routes/leases';
import paymentsRouter from './routes/payments';
import dashboardRouter from './routes/dashboard';

const app = express();

app.use(
  cors({
    origin: [process.env.FRONTEND_URL || 'http://localhost:3000'],
    credentials: true,
  })
);
app.use(express.json());

// Public routes (no auth required)
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

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Axia backend running on port ${PORT}`);
});

export default app;
