import { MAX_ITEM_NAME_LENGTH, MAX_ITEMS_PER_MESSAGE } from "./constants";

export const MESSAGES = Object.freeze({
  health: "準備完了",
  internalError: "処理に失敗しました",
  emptyItems: "リストは空です",
  emptyReminderPage:
    "このページの予定はありません。リマインドで一覧を更新してください",
  emptyReminders: "未送信リマインダーはありません",
  limitError: `1メッセージは${MAX_ITEMS_PER_MESSAGE}品目まで、品目名は${MAX_ITEM_NAME_LENGTH}文字までです`,
  help: "+テスト品目: 追加\n-テスト品目: 削除\nリスト / りすと: 買い物一覧\n/テスト 明日15時: 単発リマインダー登録\nリマインド: 未送信一覧\nリマインド削除 3: 取消\nヘルプ: 使い方",
  usage: Object.freeze({
    add: "使用例: +テスト品目",
    remove: "使用例: -テスト品目",
    reminder: "使用例: /テスト 明日15時",
    remind_delete: "使用例: リマインド削除 3",
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
  item: (name: string) => `・${name}`,
  omitted: (count: number) => `…他${count}件`,
  reminder: (id: number, time: string, content: string) =>
    `#${id} ${time} ${content}`,
  registrationPrefix: (id: number) => `登録 #${id}: `,
  registrationSuffix: (id: number, time: string) =>
    ` → ${time}\n取消: リマインド削除 ${id}`,
  cancelButton: (id: number) => `取消 #${id}`,
  cancelButtonsTitle: "取消する予定を選んでください",
  nextReminderPage: "次のページ",
  alreadyCanceled: (id: number) => `すでに取消済みです: #${id}`,
  alreadySent: (id: number) => `すでに送信済みです: #${id}`,
  canceled: (id: number) => `取消: #${id}`,
  missingReminder: (id: number) => `見つからない: #${id}`,
  truncated: "…",
});
