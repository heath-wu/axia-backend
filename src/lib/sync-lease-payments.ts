import { prisma } from './prisma';
import { generateMonthlyDueDates } from './lease-payments';
import { toDateKey } from './lease-validation';
import { derivePaymentStatus } from './payment-status';

export async function syncLeasePayments(
  leaseId: string,
  startDate: Date,
  endDate: Date,
  rentAmount: number,
  now = new Date()
) {
  const desiredDueDates = generateMonthlyDueDates(startDate, endDate);
  const desiredKeySet = new Set(desiredDueDates.map((date) => toDateKey(date)));
  const existingPayments = await prisma.payment.findMany({
    where: { leaseId },
    orderBy: { dueDate: 'asc' },
  });
  const existingKeySet = new Set(existingPayments.map((payment) => toDateKey(payment.dueDate)));

  const deleteIds = existingPayments
    .filter((payment) => !payment.paidAt && !desiredKeySet.has(toDateKey(payment.dueDate)))
    .map((payment) => payment.id);

  const mutableExisting = existingPayments.filter(
    (payment) => !payment.paidAt && desiredKeySet.has(toDateKey(payment.dueDate))
  );

  const createData = desiredDueDates
    .filter((date) => !existingKeySet.has(toDateKey(date)))
    .map((date) => ({
      leaseId,
      amount: rentAmount,
      dueDate: date,
      paidAt: null,
      status: derivePaymentStatus(date, null, now),
    }));

  if (deleteIds.length > 0) {
    await prisma.payment.deleteMany({
      where: { id: { in: deleteIds } },
    });
  }

  await Promise.all(
    mutableExisting.map((payment) =>
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          amount: rentAmount,
          status: derivePaymentStatus(payment.dueDate, null, now),
          paidAt: null,
        },
      })
    )
  );

  if (createData.length > 0) {
    await prisma.payment.createMany({ data: createData });
  }
}
