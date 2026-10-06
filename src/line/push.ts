import { MAX_REPLY_TEXT_LENGTH, PUSH_TIMEOUT_MS } from "../constants";

type Fetcher = (
  url: string,
  init: Readonly<{
    method: string;
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
  }>,
) => Promise<
  Readonly<{ ok: boolean; status: number; headers: Pick<Headers, "get"> }>
>;

export class PushFailure extends Error {
  constructor(readonly status: number) {
    super("LINE_PUSH_FAILED");
  }
}

// 公式「プッシュメッセージを送る」「APIリクエストを再試行する」: 最初からUUID、受理済み409は成功。
export function createPushClient(
  fetcher: Fetcher = (url, init) => fetch(url, init),
) {
  return async (
    token: string,
    to: string,
    text: string,
    retryKey: string,
  ): Promise<void> => {
    if (
      !token ||
      !to ||
      !text ||
      text.length > MAX_REPLY_TEXT_LENGTH ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        retryKey,
      )
    )
      throw new Error("LINE_PUSH_INVALID");
    const response = await fetcher("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Line-Retry-Key": retryKey,
      },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (
      response.ok ||
      (response.status === 409 &&
        response.headers.get("x-line-accepted-request-id"))
    )
      return;
    throw new PushFailure(response.status);
  };
}
