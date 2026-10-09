import {
  MAX_TEXT_MESSAGE_LENGTH,
  MILLISECONDS_PER_MINUTE,
  REMINDER_PAGE_SIZE,
  REMINDER_PREVIEW_LENGTH,
  TOKYO_OFFSET_MINUTES,
  WEEKDAY_NAMES,
} from "../constants";
import type { Reply } from "../domain/reply";
import { MESSAGES, REPLY_TEXT } from "../messages";

export function formatTokyoTime(instant: string): string {
  const date = new Date(
    Date.parse(instant) + TOKYO_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE,
  );
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${WEEKDAY_NAMES.charAt(date.getUTCDay())}) ${hour}:${minute}`;
}

// 公式「テキストメッセージ」: UTF-16で5000以内。行を分断せず残り件数を返す。
export function boundedList(lines: readonly string[], empty: string): string {
  if (!lines.length) return empty;
  const included: string[] = [];
  for (const [index, line] of lines.entries()) {
    const candidate = [...included, line].join("\n");
    const remaining = lines.length - index - 1;
    const withSuffix = remaining
      ? `${candidate}\n${REPLY_TEXT.omitted(remaining)}`
      : candidate;
    if (withSuffix.length > MAX_TEXT_MESSAGE_LENGTH)
      return [...included, REPLY_TEXT.omitted(lines.length - index)].join("\n");
    included.push(line);
  }
  return included.join("\n");
}

function shortenContent(content: string, maximum: number): string {
  if (content.length <= maximum) return content;
  const characters: string[] = [];
  let length = REPLY_TEXT.truncated.length;
  for (const character of content) {
    if (length + character.length > maximum) break;
    characters.push(character);
    length += character.length;
  }
  return characters.join("") + REPLY_TEXT.truncated;
}

export function reminderResultText(
  prefix: string,
  content: string,
  suffix: string,
): string {
  const maximum = MAX_TEXT_MESSAGE_LENGTH - prefix.length - suffix.length;
  return prefix + shortenContent(content, maximum) + suffix;
}

export function registrationReply(time: string, content: string): string {
  return reminderResultText(
    REPLY_TEXT.registrationPrefix,
    content,
    REPLY_TEXT.registrationSuffix(time),
  );
}

// 公式「テキストメッセージ」: 接頭辞を含めたUTF-16上限で省略する。
export function reminderPushText(content: string): string {
  return (
    REPLY_TEXT.pushPrefix +
    shortenContent(
      content,
      MAX_TEXT_MESSAGE_LENGTH - REPLY_TEXT.pushPrefix.length,
    )
  );
}

export function reminderPageReply(
  rows: readonly Readonly<{ id: number; remind_at: string; content: string }>[],
  offset: number,
): Reply {
  const page = rows.slice(offset, offset + REMINDER_PAGE_SIZE);
  if (!page.length)
    return offset ? MESSAGES.emptyReminderPage : MESSAGES.emptyReminders;
  const next = offset + page.length;
  return {
    type: "reminder_list",
    reminders: page.map((row) => ({
      id: row.id,
      time: formatTokyoTime(row.remind_at),
      content: shortenContent(row.content, REMINDER_PREVIEW_LENGTH),
    })),
    nextOffset: next < rows.length ? next : null,
  };
}
