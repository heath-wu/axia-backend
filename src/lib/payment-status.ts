import { toDateKey } from './lease-validation';

export const PAYMENT_STATUSES = ['upcoming', 'paid', 'late_paid', 'late_unpaid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

type PaymentSnapshot = {
  dueDate: Date;
  paidAt: Date | null;
  status?: string | null;
};

export function isPaymentStatus(value: string): value is PaymentStatus {
  return PAYMENT_STATUSES.includes(value as PaymentStatus);
}

export function derivePaymentStatus(
  dueDate: Date,
  paidAt: Date | null,
  now = new Date()
): PaymentStatus {
  if (paidAt) {
    return toDateKey(paidAt) > toDateKey(dueDate) ? 'late_paid' : 'paid';
  }

  return toDateKey(dueDate) < toDateKey(now) ? 'late_unpaid' : 'upcoming';
}

export function normalizePaymentStatus(payment: PaymentSnapshot, now = new Date()): PaymentStatus {
  if (payment.paidAt || !payment.status || !isPaymentStatus(payment.status)) {
    return derivePaymentStatus(payment.dueDate, payment.paidAt, now);
  }

  if (payment.status === 'paid' || payment.status === 'late_paid') {
    return payment.status;
  }

  return derivePaymentStatus(payment.dueDate, null, now);
}

export function getPaymentStatusLabel(status: PaymentStatus) {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'late_paid':
      return 'Late (Paid)';
    case 'late_unpaid':
      return 'Late (Unpaid)';
    case 'upcoming':
    default:
      return 'Upcoming';
  }
}
