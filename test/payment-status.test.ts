import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePaymentStatus,
  getPaymentStatusLabel,
  normalizePaymentStatus,
} from '../src/lib/payment-status';

function d(value: string) {
  return new Date(value);
}

test('derivePaymentStatus returns upcoming for unpaid future payments', () => {
  assert.equal(derivePaymentStatus(d('2026-06-01'), null, d('2026-05-01')), 'upcoming');
});

test('derivePaymentStatus returns late_unpaid for unpaid past-due payments', () => {
  assert.equal(derivePaymentStatus(d('2026-05-01'), null, d('2026-05-02')), 'late_unpaid');
});

test('derivePaymentStatus returns paid for on-time payments', () => {
  assert.equal(derivePaymentStatus(d('2026-05-01'), d('2026-05-01'), d('2026-05-01')), 'paid');
});

test('derivePaymentStatus returns late_paid for late payments', () => {
  assert.equal(derivePaymentStatus(d('2026-05-01'), d('2026-05-05'), d('2026-05-05')), 'late_paid');
});

test('normalizePaymentStatus derives from paidAt even when stored status is stale', () => {
  assert.equal(
    normalizePaymentStatus({
      dueDate: d('2026-05-01'),
      paidAt: d('2026-05-05'),
      status: 'paid',
    }),
    'late_paid'
  );
});

test('getPaymentStatusLabel formats demo-friendly payment labels', () => {
  assert.equal(getPaymentStatusLabel('late_paid'), 'Late (Paid)');
  assert.equal(getPaymentStatusLabel('late_unpaid'), 'Late (Unpaid)');
});
