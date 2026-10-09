import { LINE_ENDPOINTS, MAX_TEXT_MESSAGE_LENGTH } from "../constants";
import type { Reply } from "../domain/reply";
import { listMessage } from "./list-message";

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
        : listMessage(reply);
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
