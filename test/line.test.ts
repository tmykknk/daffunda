import { expect, test, vi } from "vitest";
import { createPushClient } from "../src/line/push";
import { createReplyClient } from "../src/line/reply";
import { verifySignature } from "../src/line/verify";

test("署名検証は空secret・不正Base64を拒否する", async () => {
  const body = new TextEncoder().encode("{}").buffer;
  expect(await verifySignature(body, "invalid", "test-secret")).toBe(false);
  expect(await verifySignature(body, "", "")).toBe(false);
  expect(
    await verifySignature(body, `${"A".repeat(42)}B=`, "test-secret"),
  ).toBe(false);
});
// 公式「応答メッセージを送る」「テキストメッセージ」: 1リクエストでtext1件。
test("ReplyクライアントはJSONとBearerで送信し、失敗本文を例外へ含めない", async () => {
  const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
  const reply = createReplyClient(fetcher);
  await reply("test-access-token", "test-reply-token", "テスト返信");
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.line.me/v2/bot/message/reply",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-access-token",
      },
      body: JSON.stringify({
        replyToken: "test-reply-token",
        messages: [{ type: "text", text: "テスト返信" }],
      }),
    },
  );
  fetcher.mockResolvedValueOnce({ ok: false, status: 429 });
  await expect(
    reply("test-access-token", "test-reply-token", "テスト返信"),
  ).rejects.toThrow("LINE_REPLY_FAILED:429");
});

test("Replyの空値と5000超は送信前に拒否する", async () => {
  const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
  const reply = createReplyClient(fetcher);
  for (const args of [
    ["", "test-reply", "テスト"],
    ["test-token", "", "テスト"],
    ["test-token", "test-reply", ""],
    ["test-token", "test-reply", "あ".repeat(5001)],
  ]) {
    await expect(
      reply(args[0] ?? "", args[1] ?? "", args[2] ?? ""),
    ).rejects.toThrow("LINE_REPLY_INVALID");
  }
  expect(fetcher).not.toHaveBeenCalled();
});

// 公式「プッシュメッセージを送る」「APIリクエストを再試行する」「テキストメッセージ」。
test("Pushはgroup宛てtext1件をUUID付きで送り、受理済み409だけ成功にする", async () => {
  const key = crypto.randomUUID();
  const fetcher = vi.fn<NonNullable<Parameters<typeof createPushClient>[0]>>(
    async () => ({ ok: true, status: 200, headers: new Headers() }),
  );
  const send = createPushClient(fetcher);
  await send("test-token", "C_test_group_1", "テスト", key);
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.line.me/v2/bot/message/push",
    expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
        "X-Line-Retry-Key": key,
      },
      body: JSON.stringify({
        to: "C_test_group_1",
        messages: [{ type: "text", text: "テスト" }],
      }),
      signal: expect.any(AbortSignal),
    }),
  );
  fetcher.mockResolvedValue({
    ok: false,
    status: 409,
    headers: new Headers({
      "x-line-accepted-request-id": "test-accepted-request",
    }),
  });
  await expect(
    send("test-token", "C_test_group_1", "テスト", key),
  ).resolves.toBeUndefined();
  fetcher.mockResolvedValue({ ok: false, status: 409, headers: new Headers() });
  await expect(
    send("test-token", "C_test_group_1", "テスト", key),
  ).rejects.toMatchObject({ status: 409 });
  fetcher.mockResolvedValue({ ok: false, status: 500, headers: new Headers() });
  await expect(
    send("test-token", "C_test_group_1", "テスト", key),
  ).rejects.toMatchObject({ status: 500 });
});

test("Pushは空欄・不正UUID・文字数上限をfetch前に拒否する", async () => {
  const fetcher = vi.fn<NonNullable<Parameters<typeof createPushClient>[0]>>(
    async () => ({ ok: true, status: 200, headers: new Headers() }),
  );
  const send = createPushClient(fetcher);
  const key = crypto.randomUUID();
  for (const input of [
    ["", "C_test_group_1", "テスト", key],
    ["test-token", "", "テスト", key],
    ["test-token", "C_test_group_1", "", key],
    ["test-token", "C_test_group_1", "あ".repeat(5001), key],
    ["test-token", "C_test_group_1", "テスト", "invalid"],
  ]) {
    const [token = "", to = "", text = "", retryKey = ""] = input;
    await expect(send(token, to, text, retryKey)).rejects.toThrow(
      "LINE_PUSH_INVALID",
    );
  }
  expect(fetcher).not.toHaveBeenCalled();
});
