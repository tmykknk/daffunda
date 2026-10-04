import { ja, type ParsedResult } from "chrono-node";
import { TOKYO_OFFSET_MINUTES } from "../constants";
import { normalizeText } from "./normalize";
import { hasDateTimeHint, prepareReminderText } from "./reminder-preprocess";
import { reminderDeadline, resolveReminderInstant } from "./reminder-time";

type ReminderError =
  | "PAST"
  | "UNPARSEABLE"
  | "NO_CONTENT"
  | "NO_DATETIME"
  | "MULTIPLE"
  | "TOO_FAR";
type ReminderResult =
  | Readonly<{ ok: true; content: string; remindAt: string }>
  | Readonly<{ ok: false; code: ReminderError }>;

function finishReminder(
  content: string,
  result: ParsedResult,
  now: Date,
): ReminderResult {
  if (hasDateTimeHint(content)) return { ok: false, code: "UNPARSEABLE" };
  if (!content) return { ok: false, code: "NO_CONTENT" };
  const instant = resolveReminderInstant(result.start, result.text, now);
  if (!Number.isFinite(instant.getTime()))
    return { ok: false, code: "UNPARSEABLE" };
  if (instant.getTime() <= now.getTime()) return { ok: false, code: "PAST" };
  if (instant.getTime() > reminderDeadline(now).getTime())
    return { ok: false, code: "TOO_FAR" };
  return { ok: true, content, remindAt: instant.toISOString() };
}

export function parseReminder(raw: string, now: Date): ReminderResult {
  if (!Number.isFinite(now.getTime()))
    return { ok: false, code: "UNPARSEABLE" };
  const normalized = normalizeText(raw);
  if (!normalized) return { ok: false, code: "NO_CONTENT" };
  if (/来月|そのうち/u.test(normalized))
    return { ok: false, code: "UNPARSEABLE" };
  const text = prepareReminderText(normalized, now);
  const results = ja.parse(text, {
    instant: now,
    timezone: TOKYO_OFFSET_MINUTES,
  });
  if (results.length > 1 || results.some((result) => result.end))
    return { ok: false, code: "MULTIPLE" };
  const result = results[0];
  if (!result)
    return {
      ok: false,
      code: hasDateTimeHint(normalized) ? "UNPARSEABLE" : "NO_DATETIME",
    };
  const content = (
    text.slice(0, result.index) + text.slice(result.index + result.text.length)
  ).trim();
  return finishReminder(content, result, now);
}
