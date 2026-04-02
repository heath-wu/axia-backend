import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveLeaseStatus,
  isActiveWindow,
  normalizeLeaseStatus,
  validateStatusForDates,
  rangesOverlap,
} from '../src/lib/lease-validation';

function d(value: string) {
  return new Date(value);
}

test('deriveLeaseStatus returns pending before start', () => {
  const status = deriveLeaseStatus(d('2026-05-01'), d('2027-05-01'), d('2026-04-01'));
  assert.equal(status, 'pending');
});

test('deriveLeaseStatus returns active inside window', () => {
  const status = deriveLeaseStatus(d('2026-01-01'), d('2027-01-01'), d('2026-06-01'));
  assert.equal(status, 'active');
});

test('deriveLeaseStatus returns expired on end date', () => {
  const status = deriveLeaseStatus(d('2026-01-01'), d('2027-01-01'), d('2027-01-01'));
  assert.equal(status, 'expired');
});

test('normalizeLeaseStatus keeps signed leases signed before start date', () => {
  const status = normalizeLeaseStatus('signed', d('2026-05-01'), d('2027-05-01'), d('2026-04-01'));
  assert.equal(status, 'signed');
});

test('normalizeLeaseStatus auto-activates signed leases on start date', () => {
  const status = normalizeLeaseStatus('signed', d('2026-05-01'), d('2027-05-01'), d('2026-05-01'));
  assert.equal(status, 'active');
});

test('normalizeLeaseStatus keeps closed leases closed', () => {
  const status = normalizeLeaseStatus('closed', d('2026-01-01'), d('2027-01-01'), d('2026-06-01'));
  assert.equal(status, 'closed');
});

test('isActiveWindow is half-open [start, end)', () => {
  assert.equal(isActiveWindow(d('2026-01-01'), d('2026-02-01'), d('2026-01-01')), true);
  assert.equal(isActiveWindow(d('2026-01-01'), d('2026-02-01'), d('2026-02-01')), false);
});

test('validateStatusForDates rejects active outside active window', () => {
  const err = validateStatusForDates('active', d('2026-05-01'), d('2026-06-01'), d('2026-04-01'));
  assert.ok(err);
});

test('validateStatusForDates rejects expired before end date', () => {
  const err = validateStatusForDates('expired', d('2026-01-01'), d('2026-12-01'), d('2026-06-01'));
  assert.ok(err);
});

test('validateStatusForDates rejects signed leases on or after the end date', () => {
  const err = validateStatusForDates('signed', d('2026-01-01'), d('2026-12-01'), d('2026-12-01'));
  assert.ok(err);
});

test('validateStatusForDates rejects pending on/after end date', () => {
  const err = validateStatusForDates('pending', d('2026-01-01'), d('2026-12-01'), d('2026-12-01'));
  assert.ok(err);
});

test('rangesOverlap allows adjacent intervals and blocks intersecting intervals', () => {
  assert.equal(
    rangesOverlap(d('2026-01-01'), d('2026-02-01'), d('2026-02-01'), d('2026-03-01')),
    false
  );
  assert.equal(
    rangesOverlap(d('2026-01-01'), d('2026-03-01'), d('2026-02-01'), d('2026-04-01')),
    true
  );
});
