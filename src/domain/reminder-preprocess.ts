import {
  DAY_PERIOD_HOURS,
  DAYS_PER_WEEK,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
  RELATIVE_DAY_OFFSETS,
  WEEK_OFFSETS,
  WEEKDAY_NAMES,
} from "../constants";
import {
  createCalendarDate,
  formatCalendarDate,
  toTokyoCalendar,
} from "./reminder-time";

function repairYearlessDates(text: string, today: Date): string {
  return text.replace(
    /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/gu,
    (original, month: string, day: string) => {
      const year = today.getUTCFullYear();
      const current = createCalendarDate(year, Number(month) - 1, Number(day));
      if (Number.isFinite(current.getTime())) return original;
      const next = createCalendarDate(year + 1, Number(month) - 1, Number(day));
      return Number.isFinite(next.getTime())
        ? `${formatCalendarDate(next)} `
        : original;
    },
  );
}

function offsetDate(today: Date, days: number): string {
  return `${formatCalendarDate(new Date(today.getTime() + days * MILLISECONDS_PER_DAY))} `;
}

function replaceWeekdays(text: string, today: Date): string {
  return text.replace(
    /(再来週|来週|今週|毎週)?([月火水木金土日])曜(?:日)?/gu,
    (_match, prefix: string | undefined, weekday: string) => {
      const target = WEEKDAY_NAMES.indexOf(weekday);
      const week = WEEK_OFFSETS[prefix ?? ""];
      const current = today.getUTCDay();
      const days =
        week === undefined
          ? (target - current + DAYS_PER_WEEK) % DAYS_PER_WEEK || DAYS_PER_WEEK
          : week * DAYS_PER_WEEK -
            ((current + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK) +
            ((target + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK);
      return offsetDate(today, days);
    },
  );
}

function replaceRelativeTimes(text: string, now: Date): string {
  return text.replace(
    /(\d+)(分|時間)後/gu,
    (_match, count: string, unit: string) => {
      const minutes = Number(count) * (unit === "時間" ? MINUTES_PER_HOUR : 1);
      const calendar = toTokyoCalendar(
        new Date(now.getTime() + minutes * MILLISECONDS_PER_MINUTE),
      );
      return `${formatCalendarDate(calendar)} ${calendar.getUTCHours()}:${String(calendar.getUTCMinutes()).padStart(2, "0")} `;
    },
  );
}

export function prepareReminderText(text: string, now: Date): string {
  const today = toTokyoCalendar(now);
  const relative = replaceRelativeTimes(
    repairYearlessDates(text, today),
    now,
  ).replace(/(\d+)日後/gu, (_match, count: string) =>
    offsetDate(today, Number(count)),
  );
  const weekdays = replaceWeekdays(relative, today);
  const days = weekdays.replace(/明後日|明日|今日|昨日/gu, (word) =>
    offsetDate(today, Number(RELATIVE_DAY_OFFSETS[word])),
  );
  const monthEnd = days.replaceAll(
    "月末",
    `${formatCalendarDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)))} `,
  );
  return monthEnd
    .replace(
      /(?:の)?(今夜|夕方|朝|昼|夜)(?=$|\s)/gu,
      (_match, word: string) => `${DAY_PERIOD_HOURS[word]}:00`,
    )
    .replace(/(?<!\d)24時(?!\d|半)/gu, "0:00");
}

export function hasDateTimeHint(text: string): boolean {
  return /来月|そのうち|明後日|明日|今日|昨日|月末|来週|今週|再来週|[月火水木金土日]曜|今夜|夕方|(?:^|\s)[朝昼夜](?:$|\s)|\d+\s*(?:時|分|日|年|月|\/|:)/u.test(
    text,
  );
}
