import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { derivePaymentStatus } from '../src/lib/payment-status';
import { generateMonthlyDueDates } from '../src/lib/lease-payments';
dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

function formatYearMonth(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getSeedPaymentSnapshot(dueDate: Date, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const dueKey = dueDate.toISOString().slice(0, 10);
  const previousMonthKey = previousMonthStart.toISOString().slice(0, 10);
  const monthStartKey = monthStart.toISOString().slice(0, 10);

  if (dueKey === previousMonthKey) {
    const paidAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5));
    return {
      paidAt,
      status: derivePaymentStatus(dueDate, paidAt, now),
    };
  }

  if (dueKey < monthStartKey) {
    return {
      paidAt: dueDate,
      status: derivePaymentStatus(dueDate, dueDate, now),
    };
  }

  return {
    paidAt: null,
    status: derivePaymentStatus(dueDate, null, now),
  };
}

function createUtcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day));
}

async function resolveUserId(): Promise<string> {
  // Fast path: UUID provided directly (bypasses Supabase Auth API)
  if (process.env.DEMO_USER_UUID) {
    console.log(`Using provided DEMO_USER_UUID: ${process.env.DEMO_USER_UUID}`);
    return process.env.DEMO_USER_UUID;
  }

  // Slow path: create via Supabase Admin API
  console.log('Creating demo user via Supabase Admin API...');
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email: 'demo@axia.com',
      password: 'AxiaDemo2024!',
      email_confirm: true,
      user_metadata: { name: 'Demo Landlord' },
    });

  if (authError) {
    if (authError.message.includes('already been registered')) {
      console.log('Demo user already exists — fetching...');
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
      const existing = listData?.users.find((u) => u.email === 'demo@axia.com');
      if (!existing) throw new Error('Could not find existing demo user');
      return existing.id;
    }
    throw authError;
  }

  console.log(`✅ Demo user created: ${authData.user!.id}`);
  return authData.user!.id;
}

async function seed() {
  console.log('🌱 Starting seed...');

  const userId = await resolveUserId();

  // Upsert User row in DB
  const user = await prisma.user.upsert({
    where: { id: userId },
    update: { name: 'Demo Landlord' },
    create: { id: userId, email: 'demo@axia.com', name: 'Demo Landlord' },
  });
  console.log(`✅ User row upserted: ${user.id}`);

  // Cleanup prior seed data for this user so reseeding remains deterministic.
  await prisma.payment.deleteMany({
    where: { lease: { property: { ownerId: user.id } } },
  });
  await prisma.lease.deleteMany({
    where: { property: { ownerId: user.id } },
  });
  await prisma.property.deleteMany({
    where: { ownerId: user.id },
  });
  await prisma.tenant.deleteMany({
    where: { ownerId: user.id },
  });
  console.log('✅ Existing seed-linked data cleaned');

  // 3 properties
  console.log('Creating properties...');
  const propertiesData = [
    {
      name: 'Maple Street Apartments',
      address: '142 Maple St, Austin, TX 78701',
      imageUrl:
        'https://images.pexels.com/photos/29145562/pexels-photo-29145562.jpeg?auto=compress&cs=tinysrgb&w=1400&fit=crop',
    },
    {
      name: 'Oak Grove Townhomes',
      address: '891 Oak Grove Blvd, Austin, TX 78745',
      imageUrl:
        'https://images.pexels.com/photos/35018313/pexels-photo-35018313.jpeg?auto=compress&cs=tinysrgb&w=1400&fit=crop',
    },
    {
      name: 'River View Condos',
      address: '2204 Riverside Dr, Austin, TX 78741',
      imageUrl:
        'https://images.pexels.com/photos/4997546/pexels-photo-4997546.jpeg?auto=compress&cs=tinysrgb&w=1400&fit=crop',
    },
  ];

  const properties = await Promise.all(
    propertiesData.map((p) =>
      prisma.property.upsert({
        where: { id: `seed-prop-${p.name.toLowerCase().replace(/\s+/g, '-')}` },
        update: p,
        create: {
          id: `seed-prop-${p.name.toLowerCase().replace(/\s+/g, '-')}`,
          ...p,
          ownerId: user.id,
        },
      })
    )
  );
  console.log(`✅ ${properties.length} properties created`);

  // 5 tenants
  console.log('Creating tenants...');
  const tenantsData = [
    { name: 'Sarah Johnson', email: 'sarah.johnson@email.com', phone: '(512) 555-0101' },
    { name: 'Marcus Williams', email: 'marcus.w@email.com', phone: '(512) 555-0102' },
    { name: 'Emily Chen', email: 'emily.chen@email.com', phone: '(512) 555-0103' },
    { name: 'James Rodriguez', email: 'james.r@email.com', phone: '(512) 555-0104' },
    { name: 'Aisha Patel', email: 'aisha.patel@email.com', phone: '(512) 555-0105' },
  ];

  const tenants = await Promise.all(
    tenantsData.map((t) =>
      prisma.tenant.upsert({
        where: { id: `seed-tenant-${t.email}` },
        update: { ownerId: user.id },
        create: { id: `seed-tenant-${t.email}`, ownerId: user.id, ...t },
      })
    )
  );
  console.log(`✅ ${tenants.length} tenants created`);

  // 5 leases
  console.log('Creating leases...');
  const now = new Date();
  const leasesData = [
    {
      id: 'seed-lease-1',
      propertyId: properties[0].id,
      tenantId: tenants[0].id,
      rentAmount: 1850,
      startDate: createUtcDate(now.getFullYear(), 0, 1),
      endDate: createUtcDate(now.getFullYear() + 1, 0, 1),
      status: 'active',
      concessions: 'Waived application fee',
      fees: 'Parking $75/month',
      specialTerms: 'Resident may renew with 60 days notice.',
    },
    {
      id: 'seed-lease-2',
      propertyId: properties[0].id,
      tenantId: tenants[1].id,
      rentAmount: 1750,
      startDate: createUtcDate(now.getFullYear() - 1, 0, 1),
      endDate: createUtcDate(now.getFullYear(), 0, 1),
      status: 'expired',
      concessions: 'First month prorated',
    },
    {
      id: 'seed-lease-3',
      propertyId: properties[1].id,
      tenantId: tenants[2].id,
      rentAmount: 2200,
      startDate: createUtcDate(now.getFullYear() - 1, 6, 1),
      endDate: createUtcDate(now.getFullYear(), 6, 1),
      status: 'active',
      fees: 'Pet rent $35/month',
      specialTerms: 'Includes two reserved parking spaces.',
    },
    {
      id: 'seed-lease-4',
      propertyId: properties[2].id,
      tenantId: tenants[3].id,
      rentAmount: 1950,
      startDate: createUtcDate(now.getFullYear() + 1, 0, 1),
      endDate: createUtcDate(now.getFullYear() + 2, 0, 1),
      status: 'signed',
      concessions: 'Half off first month rent',
      fees: 'Storage locker $25/month',
    },
    {
      id: 'seed-lease-5',
      propertyId: properties[2].id,
      tenantId: tenants[4].id,
      rentAmount: 1600,
      startDate: createUtcDate(now.getFullYear() - 2, 0, 1),
      endDate: createUtcDate(now.getFullYear() - 1, 0, 1),
      status: 'expired',
    },
  ];

  const leases = await Promise.all(
    leasesData.map((l) =>
      prisma.lease.upsert({
        where: { id: l.id },
        update: l,
        create: l,
      })
    )
  );
  console.log(`✅ ${leases.length} leases created`);

  // Monthly payments for each lease term
  console.log('Creating payments...');
  let paymentCount = 0;
  for (const lease of leases) {
    const dueDates = generateMonthlyDueDates(lease.startDate, lease.endDate);
    const payments = dueDates.map((dueDate) => {
      const snapshot = getSeedPaymentSnapshot(dueDate, now);
      return {
        id: `seed-pay-${lease.id}-${formatYearMonth(dueDate)}`,
        leaseId: lease.id,
        amount: lease.rentAmount,
        dueDate,
        paidAt: snapshot.paidAt,
        status: snapshot.status,
      };
    });

    if (payments.length > 0) {
      await prisma.payment.createMany({ data: payments });
      paymentCount += payments.length;
    }
  }
  console.log(`✅ ${paymentCount} payments created`);

  console.log('\n✅ Seed complete!');
  console.log('Demo credentials: demo@axia.com / AxiaDemo2024!');
}

seed()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
