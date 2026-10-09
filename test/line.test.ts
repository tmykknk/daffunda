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

test("Flexは5件と最大内部IDを通し、上限・不正値は送信前に拒否する", async () => {
  const fetcher = vi.fn<NonNullable<Parameters<typeof createReplyClient>[0]>>(
    async () => ({ ok: true, status: 200 }),
  );
  const reply = createReplyClient(fetcher);
  const row = {
    id: 9007199254740991,
    content: "\n".repeat(300),
    time: "10/4(日) 09:00",
  };
  const list = {
    type: "reminder_list",
    reminders: Array.from({ length: 5 }, () => row),
    nextOffset: null,
  } satisfies Parameters<typeof reply>[2];
  await reply("test-token", "test-reply", list);
  const body = fetcher.mock.calls[0]?.[1].body;
  if (!body) throw new Error("送信なし");
  expect(new TextEncoder().encode(body).byteLength).toBeLessThan(30_000);
  expect(JSON.parse(body)).toMatchObject({
    messages: [{ contents: { body: { contents: expect.any(Array) } } }],
  });
  expect(body).not.toContain("footer");
  fetcher.mockClear();
  for (const reminders of [
    [],
    Array.from({ length: 6 }, () => row),
    ...[
      { ...row, id: 0 },
      { ...row, id: 1.5 },
      { ...row, id: Number.MAX_SAFE_INTEGER + 1 },
      { ...row, content: "" },
      { ...row, content: "あ".repeat(301) },
      { ...row, time: "" },
      { ...row, time: "あ".repeat(301) },
    ].map((invalid) => [invalid]),
  ])
    await expect(
      reply("test-token", "test-reply", { ...list, reminders }),
    ).rejects.toThrow("LINE_REPLY_INVALID");
  for (const nextOffset of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await expect(
      reply("test-token", "test-reply", { ...list, nextOffset }),
    ).rejects.toThrow("LINE_REPLY_INVALID");
  expect(fetcher).not.toHaveBeenCalled();
});

// 公式「Flex Message」「テキスト（wrap/maxLines）」「ポストバックアクション」。
test("一覧はIDを表示せず日時の右に取消ボタンを配置する", async () => {
  const fetcher = vi.fn<NonNullable<Parameters<typeof createReplyClient>[0]>>(
    async () => ({ ok: true, status: 200 }),
  );
  await createReplyClient(fetcher)("test-token", "test-reply", {
    type: "reminder_list",
    reminders: [
      {
        id: 9007199254740991,
        content: "😀テスト\n2行目\n3行目",
        time: "10/4(日) 09:00",
      },
    ],
    nextOffset: 5,
  });
  const body = fetcher.mock.calls[0]?.[1].body;
  if (!body) throw new Error("送信なし");
  expect(JSON.parse(body)).toEqual({
    replyToken: "test-reply",
    messages: [
      {
        type: "flex",
        altText: "未送信リマインダー一覧",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "md",
            contents: [
              {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                contents: [
                  {
                    type: "text",
                    text: "😀テスト\n2行目\n3行目",
                    wrap: true,
                    maxLines: 2,
                  },
                  {
                    type: "box",
                    layout: "horizontal",
                    alignItems: "center",
                    spacing: "sm",
                    contents: [
                      {
                        type: "text",
                        text: "10/4(日) 09:00",
                        wrap: true,
                        flex: 1,
                      },
                      {
                        type: "button",
                        height: "sm",
                        flex: 0,
                        action: {
                          type: "postback",
                          label: "取消",
                          data: "reminder:v1:cancel:9007199254740991",
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          footer: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "button",
                height: "sm",
                action: {
                  type: "postback",
                  label: "次のページ",
                  data: "reminder:v1:page:5",
                },
              },
            ],
          },
        },
      },
    ],
  });
});
