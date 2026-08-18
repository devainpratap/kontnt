import cron from "node-cron";

/**
 * When did a cron expression most recently fire?
 *
 * node-cron schedules future fires but never tells you about a fire that should
 * have happened while the process was down. Missed-run recovery needs exactly
 * that: the most recent scheduled instant at or before `now`, so it can ask "did
 * this task actually run since then?" and catch up the ones that slept through.
 *
 * We compute it from `cron.parse()` (node-cron already a dependency) rather than
 * adding `cron-parser`. The scheduler runs every task in Asia/Kolkata, which is
 * a fixed UTC+5:30 with no daylight saving (India has observed none since 1945),
 * so a wall-clock instant is exact arithmetic - no zoned-date library needed.
 * If genuinely complex crons are ever scheduled, swap in `cron-parser` here;
 * this handles the daily/weekly/hourly expressions the scheduler actually uses.
 */

// Asia/Kolkata, fixed. Not read from config because it is a property of the
// timezone the scheduler pins in cron.schedule(), not a tunable.
const KOLKATA_OFFSET_MINUTES = 330;

const MINUTE_MS = 60_000;

type CronFields = {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
};

/** The wall-clock fields of an instant, read in Asia/Kolkata. */
function kolkataFields(instantMs: number): { minute: number; hour: number; dayOfWeek: number; dayOfMonth: number; month: number } {
  // Shift by the fixed offset, then read UTC parts - they now read as Kolkata
  // local time. getUTCDay() returns 0=Sunday..6=Saturday, matching cron's
  // dayOfWeek; months are shifted to 1-12 to match cron's 1-based month field.
  const shifted = new Date(instantMs + KOLKATA_OFFSET_MINUTES * MINUTE_MS);
  return {
    minute: shifted.getUTCMinutes(),
    hour: shifted.getUTCHours(),
    dayOfWeek: shifted.getUTCDay(),
    dayOfMonth: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1
  };
}

function parseFields(cronExpr: string): CronFields | null {
  let parsed: unknown;
  try {
    parsed = cron.parse(cronExpr);
  } catch {
    return null;
  }
  const fields = parsed as Partial<CronFields> | null;
  if (
    !fields ||
    !Array.isArray(fields.minute) ||
    !Array.isArray(fields.hour) ||
    !Array.isArray(fields.dayOfMonth) ||
    !Array.isArray(fields.month) ||
    !Array.isArray(fields.dayOfWeek) ||
    fields.minute.length === 0
  ) {
    return null;
  }
  return fields as CronFields;
}

/**
 * The most recent instant at or before `now` at which `cronExpr` fired, in
 * Asia/Kolkata. Returns null for an unparseable expression, or if no match is
 * found within `maxDaysBack` (8 days covers a weekly cron's 7-day gap).
 *
 * Implementation: walk backward a minute at a time from `now` (truncated to the
 * minute) and return the first instant whose Kolkata wall-clock matches every
 * field. Bounded and cheap - hourly matches in <=60 steps, daily <=1440, weekly
 * <=10080 - and runs only on boot and once an hour.
 */
export function mostRecentScheduledFire(cronExpr: string, now: Date = new Date(), maxDaysBack = 8): Date | null {
  const fields = parseFields(cronExpr);
  if (!fields) {
    return null;
  }

  const minutes = new Set(fields.minute);
  const hours = new Set(fields.hour);
  const daysOfMonth = new Set(fields.dayOfMonth);
  const months = new Set(fields.month);
  const daysOfWeek = new Set(fields.dayOfWeek);

  const startMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const steps = maxDaysBack * 24 * 60;

  for (let i = 0; i <= steps; i++) {
    const ms = startMs - i * MINUTE_MS;
    const at = kolkataFields(ms);
    if (
      minutes.has(at.minute) &&
      hours.has(at.hour) &&
      daysOfWeek.has(at.dayOfWeek) &&
      daysOfMonth.has(at.dayOfMonth) &&
      months.has(at.month)
    ) {
      return new Date(ms);
    }
  }

  return null;
}
