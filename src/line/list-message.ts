import {
  LIST_PAGE_SIZE,
  MAX_ITEM_NAME_LENGTH,
  REMINDER_CONTENT_MAX_LINES,
  REMINDER_PREVIEW_LENGTH,
} from "../constants";
import { itemActionData } from "../domain/item-action";
import { reminderActionData } from "../domain/reminder-action";
import type { ItemListReply, ReminderListReply, Reply } from "../domain/reply";
import { REPLY_TEXT } from "../messages";

type ListReply = Exclude<Reply, string>;

function postbackButton(label: string, data: string) {
  return {
    type: "button",
    height: "sm",
    action: { type: "postback", label, data },
  };
}

// 公式「ボックス」「ボタン」: 水平配置で左のテキストが伸び、右のボタン幅を確保する。
function actionRow(text: string, label: string, data: string) {
  return {
    type: "box",
    layout: "horizontal",
    alignItems: "center",
    spacing: "sm",
    contents: [
      { type: "text", text, wrap: true, flex: 1 },
      { ...postbackButton(label, data), flex: 0 },
    ],
  };
}

function validatePage(reply: ListReply) {
  const rows = reply.type === "reminder_list" ? reply.reminders : reply.items;
  if (
    !rows.length ||
    rows.length > LIST_PAGE_SIZE ||
    rows.some((row) => !Number.isSafeInteger(row.id) || row.id <= 0) ||
    (reply.nextOffset !== null &&
      (!Number.isSafeInteger(reply.nextOffset) || reply.nextOffset < 0))
  )
    throw new Error("LINE_REPLY_INVALID");
}

function reminderRows(reply: ReminderListReply) {
  return reply.reminders.map((row) => {
    if (
      !row.content ||
      row.content.length > REMINDER_PREVIEW_LENGTH ||
      !row.time ||
      row.time.length > REMINDER_PREVIEW_LENGTH
    )
      throw new Error("LINE_REPLY_INVALID");
    return {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "text",
          text: row.content,
          wrap: true,
          maxLines: REMINDER_CONTENT_MAX_LINES,
        },
        actionRow(
          row.time,
          REPLY_TEXT.cancelButton,
          reminderActionData({ type: "cancel", id: row.id }),
        ),
      ],
    };
  });
}

function itemRows(reply: ItemListReply) {
  return reply.items.map((row) => {
    if (!row.name || [...row.name].length > MAX_ITEM_NAME_LENGTH)
      throw new Error("LINE_REPLY_INVALID");
    return actionRow(
      row.name,
      REPLY_TEXT.removeButton,
      itemActionData({ type: "remove_item", id: row.id }),
    );
  });
}

// 公式「Flex Message」「バブル」「テキスト（wrap/maxLines）」「ポストバックアクション」。
export function listMessage(reply: ListReply) {
  validatePage(reply);
  const content =
    reply.type === "reminder_list"
      ? { title: REPLY_TEXT.reminderListTitle, rows: reminderRows(reply) }
      : { title: REPLY_TEXT.itemListTitle, rows: itemRows(reply) };
  return {
    type: "flex",
    altText: content.title,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: content.rows,
      },
      ...(reply.nextOffset === null
        ? {}
        : {
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                postbackButton(
                  REPLY_TEXT.nextPage,
                  reply.type === "reminder_list"
                    ? reminderActionData({
                        type: "page",
                        offset: reply.nextOffset,
                      })
                    : itemActionData({
                        type: "item_page",
                        offset: reply.nextOffset,
                      }),
                ),
              ],
            },
          }),
    },
  };
}
