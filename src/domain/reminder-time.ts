import type { ParsedComponents } from "chrono-node";
import {
  AMBIGUOUS_PM_HOUR_LIMIT,
  DEFAULT_REMINDER_HOUR,
  HOURS_PER_HALF_DAY,
  MAX_REMINDER_YEARS,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_MINUTE,
  TOKYO_OFFSET_MINUTES,
} from "../constants";

const offset = TOKYO_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE;

export function toTokyoCalendar(instant: Date): Date {
  // JSTの暦をUTCフィールドで扱い、実行環境のローカルTZを参照しない。
  return new Date(instant.getTime() + offset);
}

export function formatCalendarDate(calendar: Date): string {
  return `${calendar.getUTCFullYear()}/${calendar.getUTCMonth() + 1}/${calendar.getUTCDate()}`;
}

function calendarToInstant(calendar: Date): Date {
  return new Date(calendar.getTime() - offset);
}

export function createCalendarDate(
  year: number,
  monthIndex: number,
  day: number,
): Date {
  const calendar = new Date(Date.UTC(year, monthIndex, day));
  return calendar.getUTCMonth() === monthIndex && calendar.getUTCDate() === day
    ? calendar
    : new Date(Number.NaN);
}

function resolveHour(components: ParsedComponents, text: string): number {
  if (!components.isCertain("hour")) return DEFAULT_REMINDER_HOUR;
  const hour = Number(components.get("hour"));
  if (
    text.includes("時") &&
    !components.isCertain("meridiem") &&
    hour >= 1 &&
    hour <= AMBIGUOUS_PM_HOUR_LIMIT
  )
    return hour + HOURS_PER_HALF_DAY;
  return hour;
}

function buildCalendar(
  components: ParsedComponents,
  text: string,
  today: Date,
): Date {
  const hasDate = components.isCertain("day");
  const year = components.isCertain("year")
    ? Number(components.get("year"))
    : today.getUTCFullYear();
  const month = hasDate
    ? Number(components.get("month")) - 1
    : today.getUTCMonth();
  const day = hasDate ? Number(components.get("day")) : today.getUTCDate();
  const calendar = createCalendarDate(year, month, day);
  calendar.setUTCHours(
    resolveHour(components, text),
    Number(components.get("minute")),
    0,
    0,
  );
  return calendar;
}

export function resolveReminderInstant(
  components: ParsedComponents,
  text: string,
  now: Date,
): Date {
  const calendar = buildCalendar(components, text, toTokyoCalendar(now));
  if (
    !components.isCertain("day") &&
    calendarToInstant(calendar).getTime() <= now.getTime()
  ) {
    return calendarToInstant(
      new Date(calendar.getTime() + MILLISECONDS_PER_DAY),
    );
  }
  if (
    !components.isCertain("year") &&
    components.isCertain("day") &&
    calendarToInstant(calendar).getTime() <= now.getTime()
  ) {
    const next = createCalendarDate(
      calendar.getUTCFullYear() + MAX_REMINDER_YEARS,
      calendar.getUTCMonth(),
      calendar.getUTCDate(),
    );
    next.setUTCHours(calendar.getUTCHours(), calendar.getUTCMinutes(), 0, 0);
    return calendarToInstant(next);
  }
  return calendarToInstant(calendar);
}

export function reminderDeadline(now: Date): Date {
  const calendar = toTokyoCalendar(now);
  const year = calendar.getUTCFullYear() + MAX_REMINDER_YEARS;
  const lastDay = new Date(
    Date.UTC(year, calendar.getUTCMonth() + 1, 0),
  ).getUTCDate();
  calendar.setUTCDate(Math.min(calendar.getUTCDate(), lastDay));
  calendar.setUTCFullYear(year);
  return calendarToInstant(calendar);
}
