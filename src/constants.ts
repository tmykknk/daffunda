export const TIME_ZONE = "Asia/Tokyo";
export const MAX_ITEMS_PER_MESSAGE = 20;
export const MAX_ITEM_NAME_LENGTH = 50;
export const KANA_CODE_UNIT_OFFSET = 0x60;
export const COMMANDS = Object.freeze({
  list: "リスト",
  listHiragana: "りすと",
  help: "ヘルプ",
  remindList: "リマインド",
  remindDelete: "リマインド削除",
});
export const RESERVED_WORDS: readonly string[] = [
  COMMANDS.list,
  COMMANDS.listHiragana,
  COMMANDS.help,
  COMMANDS.remindList,
];
export const MINUTES_PER_HOUR = 60;
export const MILLISECONDS_PER_MINUTE = 60_000;
export const MILLISECONDS_PER_DAY = 86_400_000;
export const TOKYO_OFFSET_MINUTES = 9 * MINUTES_PER_HOUR;
export const DAYS_PER_WEEK = 7;
export const DEFAULT_REMINDER_HOUR = 9;
export const AMBIGUOUS_PM_HOUR_LIMIT = 5;
export const HOURS_PER_HALF_DAY = 12;
export const MAX_REMINDER_YEARS = 1;
export const DAY_PERIOD_HOURS: Readonly<Record<string, number>> = {
  朝: 8,
  昼: 12,
  夕方: 17,
  夜: 20,
  今夜: 20,
};
export const RELATIVE_DAY_OFFSETS: Readonly<Record<string, number>> = {
  昨日: -1,
  今日: 0,
  明日: 1,
  明後日: 2,
};
export const WEEK_OFFSETS: Readonly<Record<string, number>> = {
  今週: 0,
  来週: 1,
  再来週: 2,
};
export const WEEKDAY_NAMES = "日月火水木金土";

export const MAX_REMINDER_ATTEMPTS = 3;
export const REMINDER_STALE_AFTER_MS = 5 * MILLISECONDS_PER_MINUTE;

// 公式「テキストメッセージ」: UTF-16符号単位で数える最大文字数。
export const MAX_REPLY_TEXT_LENGTH = 5000;
