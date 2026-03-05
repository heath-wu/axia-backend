import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

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

  // 3 properties
  console.log('Creating properties...');
  const propertiesData = [
    { name: 'Maple Street Apartments', address: '142 Maple St, Austin, TX 78701' },
    { name: 'Oak Grove Townhomes', address: '891 Oak Grove Blvd, Austin, TX 78745' },
    { name: 'River View Condos', address: '2204 Riverside Dr, Austin, TX 78741' },
  ];

  const properties = await Promise.all(
    propertiesData.map((p) =>
      prisma.property.upsert({
        where: { id: `seed-prop-${p.name.toLowerCase().replace(/\s+/g, '-')}` },
        update: {},
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
        update: {},
        create: { id: `seed-tenant-${t.email}`, ...t },
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
      startDate: new Date(now.getFullYear() - 1, 0, 1),
      endDate: new Date(now.getFullYear() + 1, 0, 1),
      status: 'active',
    },
    {
      id: 'seed-lease-2',
      propertyId: properties[0].id,
      tenantId: tenants[1].id,
      rentAmount: 1750,
      startDate: new Date(now.getFullYear() - 1, 3, 1),
      endDate: new Date(now.getFullYear() + 1, 3, 1),
      status: 'active',
    },
    {
      id: 'seed-lease-3',
      propertyId: properties[1].id,
      tenantId: tenants[2].id,
      rentAmount: 2200,
      startDate: new Date(now.getFullYear(), 0, 1),
      endDate: new Date(now.getFullYear() + 1, 0, 1),
      status: 'active',
    },
    {
      id: 'seed-lease-4',
      propertyId: properties[2].id,
      tenantId: tenants[3].id,
      rentAmount: 1950,
      startDate: new Date(now.getFullYear() + 1, 0, 1),
      endDate: new Date(now.getFullYear() + 2, 0, 1),
      status: 'pending',
    },
    {
      id: 'seed-lease-5',
      propertyId: properties[2].id,
      tenantId: tenants[4].id,
      rentAmount: 1600,
      startDate: new Date(now.getFullYear() - 2, 0, 1),
      endDate: new Date(now.getFullYear() - 1, 0, 1),
      status: 'expired',
    },
  ];

  const leases = await Promise.all(
    leasesData.map((l) =>
      prisma.lease.upsert({
        where: { id: l.id },
        update: {},
        create: l,
      })
    )
  );
  console.log(`✅ ${leases.length} leases created`);

  // 3 payments per lease
  console.log('Creating payments...');
  const pastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  for (const lease of leases) {
    await Promise.all(
      [
        { id: `seed-pay-${lease.id}-1`, dueDate: pastMonth, status: 'paid' },
        { id: `seed-pay-${lease.id}-2`, dueDate: thisMonth, status: 'overdue' },
        { id: `seed-pay-${lease.id}-3`, dueDate: nextMonth, status: 'pending' },
      ].map((p) =>
        prisma.payment.upsert({
          where: { id: p.id },
          update: {},
          create: { ...p, leaseId: lease.id, amount: lease.rentAmount },
        })
      )
    );
  }
  console.log(`✅ ${leases.length * 3} payments created`);

  console.log('\n✅ Seed complete!');
  console.log('Demo credentials: demo@axia.com / AxiaDemo2024!');
}

seed()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
