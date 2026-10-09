import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../src/index";
import { createReplyClient } from "../src/line/reply";
import { createItemsRepo } from "../src/repo/items";
import { createEventsRepo } from "../src/repo/processed-events";

const group = "C_test_group_1";
const other = "C_test_group_2";
const now = new Date("2026-10-03T03:00:00.000Z");
const secret = "test-channel-secret";
const reply = vi.fn<ReturnType<typeof createReplyClient>>(async () => {});
const items = () => createItemsRepo(env.DB);
const bindings = () => ({
  DB: env.DB,
  LINE_CHANNEL_SECRET: secret,
  LINE_CHANNEL_ACCESS_TOKEN: "test-token",
  ALLOWED_GROUP_ID: group,
});

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
afterEach(() => {
  vi.restoreAllMocks();
  reply.mockReset();
});

function event(data: string, eventId = "test-item-action") {
  return {
    type: "postback",
    mode: "active",
    webhookEventId: eventId,
    replyToken: "test-reply",
    source: { type: "group", groupId: group },
    postback: { data },
  };
}
function textEvent(text: string, eventId = "test-item-list") {
  return {
    ...event("", eventId),
    type: "message",
    message: { type: "text", text },
  };
}
async function request(
  events: readonly unknown[],
  settings = bindings(),
  validSignature = true,
) {
  const body = JSON.stringify({ events });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return createApp({ reply, now: () => now }).fetch(
    new Request("https://example.test/webhook", {
      method: "POST",
      body,
      headers: {
        "x-line-signature": validSignature
          ? btoa(String.fromCharCode(...new Uint8Array(digest)))
          : "invalid",
      },
    }),
    settings,
  );
}
async function add(name = "テスト品目", owner = group) {
  const [row] = await items().add(owner, [name], null, now);
  if (!row) throw new Error("追加失敗");
  return row;
}

// 公式「Flex Message」「ボックス」「ボタン」「ポストバックアクション」。
test.each([0, 1, 5, 6, 11])(
  "買い物一覧は追加順の5件ページを返す: %i件",
  async (count) => {
    const rows = await items().add(
      group,
      Array.from({ length: count }, (_, i) => `テスト品目${i}`),
      null,
      now,
    );
    await add("別所属", other);
    expect((await request([textEvent("りすと")])).status).toBe(200);
    expect(reply.mock.calls[0]?.[2]).toEqual(
      count
        ? {
            type: "item_list",
            items: rows.slice(0, 5).map(({ id, name }) => ({ id, name })),
            nextOffset: count > 5 ? 5 : null,
          }
        : "リストは空です",
    );
    if (count > 5) {
      await request([event("item:v1:page:5")]);
      expect(reply.mock.calls[1]?.[2]).toEqual({
        type: "item_list",
        items: rows.slice(5, 10).map(({ id, name }) => ({ id, name })),
        nextOffset: count > 10 ? 10 : null,
      });
    }
  },
);

test("買い物Flexは最大長の絵文字を全文表示し、右のボタンにだけIDを保持する", async () => {
  const row = await add("😀".repeat(50));
  const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
  reply.mockImplementationOnce(createReplyClient(fetcher));
  await request([textEvent("リスト")]);
  const body = fetcher.mock.calls[0];
  expect(body).toBeDefined();
  expect(fetcher).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      body: JSON.stringify({
        replyToken: "test-reply",
        messages: [
          {
            type: "flex",
            altText: "買い物リスト",
            contents: {
              type: "bubble",
              body: {
                type: "box",
                layout: "vertical",
                spacing: "md",
                contents: [
                  {
                    type: "box",
                    layout: "horizontal",
                    alignItems: "center",
                    spacing: "sm",
                    contents: [
                      { type: "text", text: row.name, wrap: true, flex: 1 },
                      {
                        type: "button",
                        height: "sm",
                        action: {
                          type: "postback",
                          label: "削除",
                          data: `item:v1:remove:${row.id}`,
                        },
                        flex: 0,
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      }),
    }),
  );
});

test("削除済み行を保持し、同名再登録後の古いボタンは新しい品目を消さない", async () => {
  const old = await add();
  await request([event(`item:v1:remove:${old.id}`)]);
  expect(reply.mock.calls[0]?.[2]).toBe("削除: テスト品目");
  expect(await items().list(group)).toEqual([]);
  const current = await add();
  expect(current.id).toBeGreaterThan(old.id);
  await request([event(`item:v1:remove:${old.id}`, "test-old-item")]);
  expect(reply.mock.calls[1]?.[2]).toBe("すでに削除済みです: テスト品目");
  expect((await items().list(group)).map(({ id }) => id)).toEqual([current.id]);
  expect(reply).toHaveBeenCalledTimes(2);
});

test("品目の所属を照合し、他所属と存在しないIDは同じ案内を返す", async () => {
  const row = await add("非公開テスト", other);
  await request([
    event(`item:v1:remove:${row.id}`),
    event("item:v1:remove:999", "test-missing-item"),
  ]);
  expect(reply.mock.calls.map((call) => call[2])).toEqual([
    "対象の品目が見つかりません",
    "対象の品目が見つかりません",
  ]);
  expect(await items().list(other)).toHaveLength(1);
});

test("買い物の同時再送は削除と返信を1回にし、二重タップは削除済みを案内する", async () => {
  const row = await add();
  const input = event(`item:v1:remove:${row.id}`);
  await Promise.all([request([input]), request([input])]);
  expect(reply).toHaveBeenCalledTimes(1);
  await Promise.all([
    request([event(input.postback.data, "test-tap-2")]),
    request([event(input.postback.data, "test-tap-3")]),
  ]);
  expect(reply.mock.calls.map((call) => call[2])).toEqual([
    "削除: テスト品目",
    "すでに削除済みです: テスト品目",
    "すでに削除済みです: テスト品目",
  ]);
});

test("文字削除とボタン削除が競合しても1件だけ完了する", async () => {
  const row = await add("テストみるく");
  await Promise.all([
    request([textEvent("-テストミルク")]),
    request([event(`item:v1:remove:${row.id}`)]),
  ]);
  expect(await items().list(group)).toEqual([]);
  expect(reply).toHaveBeenCalledTimes(2);
  const results = reply.mock.calls.map((call) => call[2]);
  expect(
    results.filter(
      (text) => typeof text === "string" && text.startsWith("削除:"),
    ),
  ).toHaveLength(1);
});

test("買い物削除後の照会失敗はイベントごと戻し、再送で削除できる", async () => {
  const row = await add();
  const prepare = env.DB.prepare.bind(env.DB);
  const spy = vi
    .spyOn(env.DB, "prepare")
    .mockImplementation((query) =>
      prepare(
        query.startsWith("SELECT * FROM items WHERE group_id = ? AND id = ?")
          ? query.replace("SELECT *", "SELECT missing_test_column")
          : query,
      ),
    );
  const input = event(`item:v1:remove:${row.id}`);
  expect((await request([input])).status).toBe(500);
  spy.mockRestore();
  expect(await createEventsRepo(env.DB).get(input.webhookEventId)).toBeNull();
  expect(await items().list(group)).toHaveLength(1);
  expect(reply).not.toHaveBeenCalled();
  expect((await request([input])).status).toBe(200);
  expect(await items().list(group)).toEqual([]);
});

test("買い物削除の返信失敗後は再送で更新も返信も繰り返さない", async () => {
  const row = await add();
  reply.mockRejectedValueOnce(new Error("test-reply-failure"));
  const input = event(`item:v1:remove:${row.id}`);
  expect((await request([input])).status).toBe(500);
  expect((await request([input])).status).toBe(200);
  expect(reply).toHaveBeenCalledTimes(1);
  expect(await items().list(group)).toEqual([]);
});

test("買い物のページ再送は返信を重複せず、空ページは一覧更新を案内する", async () => {
  await add();
  const input = event("item:v1:page:5");
  await request([input]);
  await request([input]);
  expect(reply).toHaveBeenCalledTimes(1);
  expect(reply.mock.calls[0]?.[2]).toBe(
    "このページの品目はありません。リストで一覧を更新してください",
  );
});

test("買い物postbackも署名・active・許可グループを検証する", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const row = await add();
  const input = event(`item:v1:remove:${row.id}`);
  expect((await request([input], bindings(), false)).status).toBe(401);
  for (const invalid of [
    { ...input, mode: "standby" },
    { ...input, replyToken: undefined },
    { ...input, webhookEventId: undefined },
    { ...input, postback: {} },
    { ...input, source: { type: "group", groupId: other } },
    { ...input, source: { type: "user", userId: "U_test_user_1" } },
    event("item:v1:remove:0"),
    event("item:v2:remove:1"),
    event("item:v1:page:-1"),
    event("x".repeat(301)),
  ])
    expect((await request([invalid])).status).toBe(200);
  for (const allowed of ["", "unset", "<ALLOWED_GROUP_ID>"])
    expect(
      (await request([input], { ...bindings(), ALLOWED_GROUP_ID: allowed }))
        .status,
    ).toBe(200);
  expect(await items().list(group)).toHaveLength(1);
  expect(await createEventsRepo(env.DB).get(input.webhookEventId)).toBeNull();
  expect(reply).not.toHaveBeenCalled();
});

test("買い物一覧を全削除した後の先頭ページは空一覧になる", async () => {
  const row = await add();
  await request([event(`item:v1:remove:${row.id}`)]);
  await request([event("item:v1:page:0", "test-empty-page-zero")]);
  expect(reply.mock.calls[1]?.[2]).toBe("リストは空です");
});

test("同名の複数行でもボタンは押したIDだけを削除する", async () => {
  const old = await add();
  await env.DB.prepare(
    "INSERT INTO items (group_id, name, norm_name, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(group, old.name, old.norm_name, now.toISOString())
    .run();
  const current = (await items().list(group))[1];
  if (!current) throw new Error("追加失敗");
  await request([event(`item:v1:remove:${current.id}`)]);
  expect((await items().list(group)).map(({ id }) => id)).toEqual([old.id]);
});

test("異なるイベントの同時初回タップは成功と削除済みを返す", async () => {
  const row = await add();
  await Promise.all([
    request([event(`item:v1:remove:${row.id}`, "test-first-tap-1")]),
    request([event(`item:v1:remove:${row.id}`, "test-first-tap-2")]),
  ]);
  expect(reply.mock.calls.map((call) => call[2]).sort()).toEqual(
    ["削除: テスト品目", "すでに削除済みです: テスト品目"].sort(),
  );
});
