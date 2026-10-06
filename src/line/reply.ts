import { LINE_ENDPOINTS, MAX_TEXT_MESSAGE_LENGTH } from "../constants";

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
  ): Promise<void> => {
    if (!token || !replyToken || !text || text.length > MAX_TEXT_MESSAGE_LENGTH)
      throw new Error("LINE_REPLY_INVALID");
    const response = await fetcher(LINE_ENDPOINTS.reply, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
    if (!response.ok) throw new Error(`LINE_REPLY_FAILED:${response.status}`);
  };
}
