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
