import {
  LINE_ENDPOINTS,
  MAX_FLEX_ACTION_LABEL_LENGTH,
  MAX_POSTBACK_DATA_LENGTH,
  MAX_TEXT_MESSAGE_LENGTH,
  REMINDER_PAGE_SIZE,
} from "../constants";

import { REPLY_TEXT } from "../messages";

export type PostbackAction = Readonly<{ label: string; data: string }>;

// 公式「Flex Message」「バブル」「ボックス」「ボタン」「ポストバックアクション」。
function cancellationButtons(actions: readonly PostbackAction[]) {
  if (
    actions.length > REMINDER_PAGE_SIZE + 1 ||
    actions.some(
      (action) =>
        !action.label ||
        action.label.length > MAX_FLEX_ACTION_LABEL_LENGTH ||
        !action.data ||
        action.data.length > MAX_POSTBACK_DATA_LENGTH,
    )
  )
    throw new Error("LINE_REPLY_INVALID");
  return {
    type: "flex",
    altText: REPLY_TEXT.cancelButtonsTitle,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: actions.map((action) => ({
          type: "button",
          height: "sm",
          action: { type: "postback", label: action.label, data: action.data },
        })),
      },
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
// 公式「応答メッセージを送る」: tokenは1回、受信後速やかに使う。自動再試行しない。
export function createReplyClient(fetcher: Fetcher = fetch) {
  return async (
    token: string,
    replyToken: string,
    text: string,
    actions: readonly PostbackAction[] = [],
  ): Promise<void> => {
    if (!token || !replyToken || !text || text.length > MAX_TEXT_MESSAGE_LENGTH)
      throw new Error("LINE_REPLY_INVALID");
    const messages = [
      { type: "text", text },
      ...(actions.length ? [cancellationButtons(actions)] : []),
    ];
    const response = await fetcher(LINE_ENDPOINTS.reply, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    });
    if (!response.ok) throw new Error(`LINE_REPLY_FAILED:${response.status}`);
  };
}
