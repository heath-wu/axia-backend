export const LEASE_STATUSES = ['pending', 'signed', 'active', 'expired', 'closed'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];

function toUtcDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function toDateKey(date: Date) {
  return toUtcDateOnly(date).toISOString().slice(0, 10);
}

export function isValidDate(date: Date) {
  return !Number.isNaN(date.getTime());
}

export function isActiveWindow(startDate: Date, endDate: Date, now = new Date()) {
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  const todayKey = toDateKey(now);
  return todayKey >= startKey && todayKey < endKey;
}

export function deriveLeaseStatus(startDate: Date, endDate: Date, now = new Date()): LeaseStatus {
  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  const todayKey = toDateKey(now);

  if (todayKey < startKey) return 'pending';
  if (todayKey >= endKey) return 'expired';
  return 'active';
}

export function normalizeLeaseStatus(
  status: string,
  startDate: Date,
  endDate: Date,
  now = new Date()
): LeaseStatus {
  if (status === 'closed') return 'closed';

  const startKey = toDateKey(startDate);
  const endKey = toDateKey(endDate);
  const todayKey = toDateKey(now);

  if (todayKey >= endKey) return 'expired';
  if (todayKey >= startKey) return 'active';
  if (status === 'signed') return 'signed';
  return 'pending';
}

export function validateStatusForDates(
  status: string,
  startDate: Date,
  endDate: Date,
  now = new Date()
): string | null {
  if (!LEASE_STATUSES.includes(status as LeaseStatus)) {
    return `status must be one of: ${LEASE_STATUSES.join(', ')}`;
  }

  if (status === 'active' && !isActiveWindow(startDate, endDate, now)) {
    return 'Lease can be active only between startDate (inclusive) and endDate (exclusive)';
  }

  if (status === 'signed' && toDateKey(now) >= toDateKey(endDate)) {
    return 'Lease cannot remain signed on/after endDate';
  }

  if (status === 'expired' && toDateKey(now) < toDateKey(endDate)) {
    return 'Lease can be expired only on/after endDate';
  }

  if (status === 'pending' && toDateKey(now) >= toDateKey(endDate)) {
    return 'Lease cannot be pending on/after endDate';
  }

  return null;
}

export function rangesOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return toDateKey(startA) < toDateKey(endB) && toDateKey(endA) > toDateKey(startB);
}
