import { GSC_TIMEZONE } from "@rankos/shared";

/**
 * Every date in RankOS is a `YYYY-MM-DD` string interpreted in Search
 * Console's reporting timezone (America/Los_Angeles), never a Date object.
 *
 * The reason is narrow but costly: if "today" is computed from the machine's
 * local clock, a sync run from India (UTC+5:30) at 09:00 local is still
 * *yesterday* in Pacific time. Days then get written under two different
 * labels, the unique key stops deduplicating, and the rolling re-pull silently
 * doubles rows instead of updating them. Anchoring to one zone removes the
 * whole class of bug.
 */

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

// en-CA renders as YYYY-MM-DD, which is exactly the wire format the Search
// Console API expects, so no reassembly is needed.
const pacificFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: GSC_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function isIsoDate(value: string): boolean {
  return isoDatePattern.test(value);
}

function assertIsoDate(value: string, label = "date"): void {
  if (!isIsoDate(value)) {
    throw new Error(`Expected ${label} as YYYY-MM-DD, received "${value}".`);
  }
}

/** The current date in Search Console's reporting timezone. */
export function todayInGscZone(now: Date = new Date()): string {
  return pacificFormatter.format(now);
}

/**
 * Shift an ISO date by whole days.
 *
 * Uses UTC arithmetic on a date-only value rather than local-time arithmetic:
 * adding 24h across a DST boundary in a zoned Date lands on the same calendar
 * day (or skips one), whereas UTC midnight arithmetic on a pure date is exact.
 */
export function addDays(date: string, days: number): string {
  assertIsoDate(date);
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `start` to `end`; negative when `end` precedes `start`. */
export function daysBetween(start: string, end: string): number {
  assertIsoDate(start, "start");
  assertIsoDate(end, "end");
  const toUtc = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(end) - toUtc(start)) / 86_400_000);
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Inclusive list of dates from `start` to `end`. Empty when end precedes start. */
export function dateRange(start: string, end: string): string[] {
  const span = daysBetween(start, end);
  if (span < 0) {
    return [];
  }
  return Array.from({ length: span + 1 }, (_, index) => addDays(start, index));
}

/**
 * Monday of the week containing `date`. Used as the `week_start` key for the
 * weekly rollup table, so charts aggregate on a stable boundary.
 */
export function startOfWeek(date: string): string {
  assertIsoDate(date);
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  // getUTCDay: 0 = Sunday. Shift so Monday is the first day of the week.
  const offset = weekday === 0 ? 6 : weekday - 1;
  return addDays(date, -offset);
}

/**
 * The most recent date Search Console is likely to have any data for.
 *
 * Google publishes with a lag; asking for today always returns nothing, which
 * looks identical to "the client lost all traffic". Anchoring the sync window
 * one day back avoids charting a phantom cliff at the right edge.
 */
export function latestLikelyDataDate(now: Date = new Date()): string {
  return addDays(todayInGscZone(now), -1);
}

/**
 * True when `date` falls inside the window Google is still revising.
 *
 * Rows in this window are real but incomplete; the UI marks them provisional
 * rather than presenting them as a settled drop. `provisionalDays` counts back
 * from `latestDate`, which is the newest date actually present in the data —
 * not from "now" — so a stale sync does not mislabel settled days.
 */
export function isProvisional(date: string, latestDate: string, provisionalDays: number): boolean {
  assertIsoDate(date);
  assertIsoDate(latestDate, "latestDate");
  if (date > latestDate) {
    return true;
  }
  return daysBetween(date, latestDate) < provisionalDays;
}

/**
 * The date window a routine sync should request: the last `windowDays` days
 * ending at the newest likely-available date. Re-pulling rather than appending
 * is what makes the sync idempotent against Google's revisions.
 */
export function rollingWindow(windowDays: number, now: Date = new Date()): { startDate: string; endDate: string } {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new Error(`rollingWindow requires a positive integer windowDays, received ${windowDays}.`);
  }
  const endDate = latestLikelyDataDate(now);
  return { startDate: addDays(endDate, -(windowDays - 1)), endDate };
}

/**
 * The full backfill window. Search Console retains roughly 16 months, so
 * requesting more just returns empty days.
 */
export function backfillWindow(months: number, now: Date = new Date()): { startDate: string; endDate: string } {
  const endDate = latestLikelyDataDate(now);
  const [year, month, day] = endDate.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1 - months, day));
  return { startDate: start.toISOString().slice(0, 10), endDate };
}
