function toUtcDateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getClampedUtcDate(year: number, month: number, dayOfMonth: number) {
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clampedDay = Math.min(dayOfMonth, lastDayOfMonth);
  return new Date(Date.UTC(year, month, clampedDay));
}

function addUtcMonths(date: Date, months: number, anchorDayOfMonth: number) {
  const nextMonthIndex = date.getUTCMonth() + months;
  const nextYear = date.getUTCFullYear() + Math.floor(nextMonthIndex / 12);
  const normalizedMonth = ((nextMonthIndex % 12) + 12) % 12;
  return getClampedUtcDate(nextYear, normalizedMonth, anchorDayOfMonth);
}

export function generateMonthlyDueDates(startDate: Date, endDate: Date) {
  const dueDates: Date[] = [];
  const firstDueDate = toUtcDateOnly(startDate);
  const normalizedEndDate = toUtcDateOnly(endDate);
  const anchorDayOfMonth = firstDueDate.getUTCDate();

  let cursor = firstDueDate;
  while (cursor < normalizedEndDate) {
    dueDates.push(new Date(cursor));
    cursor = addUtcMonths(cursor, 1, anchorDayOfMonth);
  }

  return dueDates;
}
