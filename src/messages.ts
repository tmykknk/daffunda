import { MAX_ITEM_NAME_LENGTH, MAX_ITEMS_PER_MESSAGE } from "./constants";

export const MESSAGES = Object.freeze({
  health: "準備完了",
  internalError: "処理に失敗しました",
  emptyItems: "リストは空です",
  emptyItemPage: "このページの品目はありません。リストで一覧を更新してください",
  emptyReminderPage:
    "このページの予定はありません。リマインドで一覧を更新してください",
  emptyReminders: "未送信リマインダーはありません",
  limitError: `1メッセージは${MAX_ITEMS_PER_MESSAGE}品目まで、品目名は${MAX_ITEM_NAME_LENGTH}文字までです`,
  help: "+テスト品目: 追加\n-テスト品目: 削除\nリスト / りすと: 買い物一覧（削除ボタン付き）\n/テスト 明日15時: 単発リマインダー登録\nリマインド: 未送信一覧（取消は一覧のボタンから）\nヘルプ: 使い方",
  usage: Object.freeze({
    add: "使用例: +テスト品目",
    remove: "使用例: -テスト品目",
    reminder: "使用例: /テスト 明日15時",
  }),
  reminderErrors: Object.freeze({
    PAST: "過去の日時は登録できません",
    UNPARSEABLE: "日時を解釈できません。使用例: /テスト 明日15時",
    NO_CONTENT: "リマインダーの内容を指定してください",
    NO_DATETIME: "日時を指定してください。使用例: /テスト 明日15時",
    MULTIPLE: "日時は1つだけ指定してください",
    TOO_FAR: "日時は現在から1年以内で指定してください",
  }),
});

export const REPLY_TEXT = Object.freeze({
  pushPrefix: "⏰ リマインド: ",
  added: (names: readonly string[]) => `追加: ${names.join("、")}`,
  registered: (names: readonly string[]) => `登録済み: ${names.join("、")}`,
  removed: (names: readonly string[]) => `削除: ${names.join("、")}`,
  missingItems: (names: readonly string[]) =>
    `見つからない: ${names.join("、")}`,
  reserved: (words: readonly string[]) =>
    `その名前は使えません: ${words.join("、")}`,
  registrationPrefix: "登録: ",
  registrationSuffix: (time: string) =>
    ` → ${time}\n取消は「リマインド」の一覧から`,
  reminderTimeSuffix: (time: string) => ` → ${time}`,
  cancelButton: "取消",
  removeButton: "削除",
  itemListTitle: "買い物リスト",
  alreadyRemoved: (name: string) => `すでに削除済みです: ${name}`,
  missingItem: "対象の品目が見つかりません",
  reminderListTitle: "未送信リマインダー一覧",
  nextPage: "次のページ",
  alreadyCanceled: "すでに取消済みです: ",
  alreadySent: "すでに送信済みです: ",
  canceled: "取消: ",
  missingReminder: "対象のリマインダーが見つかりません",
  truncated: "…",
});
