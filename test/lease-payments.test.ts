import assert from 'node:assert/strict';
import test from 'node:test';
import { generateMonthlyDueDates } from '../src/lib/lease-payments';

function d(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function keys(dates: Date[]) {
  return dates.map((date) => date.toISOString().slice(0, 10));
}

test('generateMonthlyDueDates anchors the first due date to the lease start date', () => {
  assert.deepEqual(
    keys(generateMonthlyDueDates(d('2026-04-02'), d('2026-07-02'))),
    ['2026-04-02', '2026-05-02', '2026-06-02']
  );
});

test('generateMonthlyDueDates never creates a due date before the lease start', () => {
  assert.deepEqual(keys(generateMonthlyDueDates(d('2026-04-30'), d('2026-05-15'))), ['2026-04-30']);
});

test('generateMonthlyDueDates clamps month-end anchors safely', () => {
  assert.deepEqual(
    keys(generateMonthlyDueDates(d('2026-01-31'), d('2026-05-01'))),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']
  );
});
