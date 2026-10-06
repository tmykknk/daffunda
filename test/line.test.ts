import { expect, test, vi } from "vitest";
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
