import {
  LINE_ENDPOINTS,
  MAX_TEXT_MESSAGE_LENGTH,
  REMINDER_CONTENT_MAX_LINES,
  REMINDER_PAGE_SIZE,
  REMINDER_PREVIEW_LENGTH,
} from "../constants";
import { reminderActionData } from "../domain/reminder-action";
import type { ReminderListReply, Reply } from "../domain/reply";
import { REPLY_TEXT } from "../messages";

function postbackButton(label: string, data: string) {
  return {
    type: "button",
    height: "sm",
    action: { type: "postback", label, data },
  };
}

// 公式「Flex Message」「バブル」「ボックス」「テキスト（wrap/maxLines）」「ポストバックアクション」。
function reminderListMessage(reply: ReminderListReply) {
  if (
    !reply.reminders.length ||
    reply.reminders.length > REMINDER_PAGE_SIZE ||
    reply.reminders.some(
      (row) =>
        !Number.isSafeInteger(row.id) ||
        row.id <= 0 ||
        !row.content ||
        row.content.length > REMINDER_PREVIEW_LENGTH ||
        !row.time ||
        row.time.length > REMINDER_PREVIEW_LENGTH,
    ) ||
    (reply.nextOffset !== null &&
      (!Number.isSafeInteger(reply.nextOffset) || reply.nextOffset < 0))
  )
    throw new Error("LINE_REPLY_INVALID");
  return {
    type: "flex",
    altText: REPLY_TEXT.reminderListTitle,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: reply.reminders.map((row) => ({
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
            {
              type: "box",
              layout: "horizontal",
              alignItems: "center",
              spacing: "sm",
              contents: [
                { type: "text", text: row.time, wrap: true, flex: 1 },
                {
                  ...postbackButton(
                    REPLY_TEXT.cancelButton,
                    reminderActionData({ type: "cancel", id: row.id }),
                  ),
                  flex: 0,
                },
              ],
            },
          ],
        })),
      },
      ...(reply.nextOffset === null
        ? {}
        : {
            footer: {
              type: "box",
              layout: "vertical",
              contents: [
                postbackButton(
                  REPLY_TEXT.nextReminderPage,
                  reminderActionData({
                    type: "page",
                    offset: reply.nextOffset,
                  }),
                ),
              ],
            },
          }),
    },
  };
}

type Fetcher = (
  url: string,
  init: Readonly<{
    method: string;
    headers: Readonly<Record<string, string>>;
    body: string;
  }>,
) => Promise<Readonly<{ ok: boolean; status: number }>>;
// 公式「応答メッセージを送る」: tokenは1回、受信後速やかに使う。返信は1メッセージ。
export function createReplyClient(fetcher: Fetcher = fetch) {
  return async (
    token: string,
    replyToken: string,
    reply: Reply,
  ): Promise<void> => {
    if (
      !token ||
      !replyToken ||
      !reply ||
      (typeof reply === "string" && reply.length > MAX_TEXT_MESSAGE_LENGTH)
    )
      throw new Error("LINE_REPLY_INVALID");
    const message =
      typeof reply === "string"
        ? { type: "text", text: reply }
        : reminderListMessage(reply);
    const response = await fetcher(LINE_ENDPOINTS.reply, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken, messages: [message] }),
    });
    if (!response.ok) throw new Error(`LINE_REPLY_FAILED:${response.status}`);
  };
}
