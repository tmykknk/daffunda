import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import worker, { createApp, createScheduled } from "../src/index";
import { createPushClient } from "../src/line/push";
import { createReplyClient } from "../src/line/reply";
import { createItemsRepo } from "../src/repo/items";
import { createEventsRepo } from "../src/repo/processed-events";
import { createRemindersRepo } from "../src/repo/reminders";
import { handleReply } from "../src/service/commands";
import { sendDueReminders } from "../src/service/scheduled";
import type { WebhookBindings } from "../src/service/webhook";

import { WEBHOOK_SIGNATURE } from "./fixtures/webhook-signature";

const group = "C_test_group_1";
const otherGroup = "C_test_group_2";
const user = "U_test_user_1";
const now = new Date("2026-10-03T03:00:00.000Z");
const items = () => createItemsRepo(env.DB);
const reminders = () => createRemindersRepo(env.DB);
const cancel = async (groupId: string, id: number, at: Date) =>
  (await reminders().cancelForButton(groupId, id, at)).status === "canceled";
const events = () => createEventsRepo(env.DB);

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

function register(content = "テスト", at = now, groupId = group) {
  return reminders().create({
    groupId,
    content,
    remindAt: at,
    createdBy: user,
    retryKey: null,
    now,
  });
}

test("マイグレーションは再適用してもデータを失わない", async () => {
  await items().add(group, ["テスト品目"], user, now);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  expect(await items().list(group)).toHaveLength(1);
});

test("品目はグループ別に追加・照合し、入力順とUTC作成日時を保つ", async () => {
  const added = await items().add(group, ["みるく", "テスト品目"], user, now);
  expect(added.map((row) => row.name)).toEqual(["みるく", "テスト品目"]);
  expect(added[0]).toMatchObject({
    group_id: group,
    norm_name: "ミルク",
    added_by: user,
    created_at: now.toISOString(),
    done_at: null,
  });
  expect(await items().add(group, ["ミルク"], user, now)).toEqual([]);
  expect(await items().add(otherGroup, ["ミルク"], null, now)).toHaveLength(1);
  expect((await items().list(otherGroup))[0]?.added_by).toBeNull();
  expect(await items().list("C_test_missing")).toEqual([]);
});

test("同時追加でも登録済みの品目を重複登録しない", async () => {
  const results = await Promise.all([
    items().add(group, ["テスト品目"], user, now),
    items().add(group, ["テスト品目"], user, now),
  ]);
  expect(results.flat()).toHaveLength(1);
  expect(await items().list(group)).toHaveLength(1);
});

test("削除はかな照合・グループ分離で古い1件だけを完了し、再追加できる", async () => {
  const old = await items().add(
    group,
    ["ミルク"],
    user,
    new Date("2026-10-01T00:00:00.000Z"),
  );
  await env.DB.prepare(
    "INSERT INTO items (group_id, name, norm_name, added_by, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(group, "みるく", "ミルク", user, now.toISOString())
    .run();
  await items().add(otherGroup, ["ミルク"], user, now);
  const removed = await items().remove(group, ["みるく", "未登録"], now);
  expect(removed).toHaveLength(1);
  expect(removed[0]).toMatchObject({
    id: old[0]?.id,
    done_at: now.toISOString(),
  });
  expect(await items().list(group)).toHaveLength(1);
  expect(await items().list(otherGroup)).toHaveLength(1);
  await items().remove(group, ["ミルク"], now);
  expect(await items().add(group, ["ミルク"], user, now)).toHaveLength(1);
});

test("空の追加・削除は無変更で、同一時刻の削除はID順で1件だけ", async () => {
  expect(await items().add(group, [], user, now)).toEqual([]);
  expect(await items().remove(group, [], now)).toEqual([]);
  await items().add(group, ["テスト品目"], user, now);
  await env.DB.prepare(
    "INSERT INTO items (group_id, name, norm_name, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(group, "テスト品目", "テスト品目", now.toISOString())
    .run();
  const before = await items().list(group);
  const removed = await items().remove(group, ["テスト品目"], now);
  expect(removed[0]?.id).toBe(before[0]?.id);
  expect(await items().list(group)).toHaveLength(1);
});

test("複数品目の追加は後半の失敗でも全体をロールバックする", async () => {
  await expect(
    items().add(group, ["テスト品目", ""], user, now),
  ).rejects.toThrow();
  expect(await items().list(group)).toEqual([]);
});

test("複数品目の削除も後半のDBエラーなら全体をロールバックする", async () => {
  await items().add(group, ["テスト品目1", "テスト品目2"], user, now);
  await env.DB.exec(
    "CREATE TRIGGER reject_second_update BEFORE UPDATE ON items WHEN OLD.name = 'テスト品目2' BEGIN SELECT RAISE(ABORT, 'TEST_ROLLBACK'); END;",
  );
  await expect(
    items().remove(group, ["テスト品目1", "テスト品目2"], now),
  ).rejects.toThrow();
  expect(await items().list(group)).toHaveLength(2);
});

test("SQL構文を含む品目・内容もバインドされたデータとして保存する", async () => {
  const name = "テスト'); DROP TABLE items; --";
  expect((await items().add(group, [name], user, now))[0]?.name).toBe(name);
  const row = await register(name);
  expect(row.content).toBe(name);
  expect(await items().list(group)).toHaveLength(1);
});

test("リマインダーはUTC・状態・試行回数・retry_keyを保存し、自グループだけ表示する", async () => {
  const row = await reminders().create({
    groupId: group,
    content: "テスト",
    remindAt: new Date("2026-10-04T15:00:00+09:00"),
    createdBy: null,
    retryKey: "test-retry-key",
    now,
  });
  expect(row).toMatchObject({
    group_id: group,
    content: "テスト",
    remind_at: "2026-10-04T06:00:00.000Z",
    created_at: now.toISOString(),
    created_by: null,
    status: "pending",
    attempts: 0,
    retry_key: "test-retry-key",
    sent_at: null,
    updated_at: now.toISOString(),
  });
  await register("別グループ", now, otherGroup);
  expect(await reminders().listUnsent(group)).toHaveLength(1);
  expect(await reminders().listUnsent("C_test_missing")).toEqual([]);
});

test("取消は自グループの未送信だけに適用し、取消済みは再取消できない", async () => {
  const row = await register();
  expect(await cancel(otherGroup, row.id, now)).toBe(false);
  expect(await cancel(group, row.id, now)).toBe(true);
  expect(await cancel(group, row.id, now)).toBe(false);
  expect(await cancel(group, 999, now)).toBe(false);
  expect(await reminders().listUnsent(group)).toEqual([]);
  expect(await reminders().claimDue(now, group)).toEqual([]);
});

test("同時claimは期限到来のpendingを一度だけ取得し、未来と取消を除外する", async () => {
  const due = await register();
  await register("未来", new Date("2026-10-04T00:00:00.000Z"));
  const canceled = await register("取消");
  await cancel(group, canceled.id, now);
  const claims = (
    await Promise.all([
      reminders().claimDue(now, group),
      reminders().claimDue(now, group),
    ])
  ).flat();
  expect(claims).toHaveLength(1);
  expect(claims[0]).toMatchObject({
    id: due.id,
    status: "sending",
    updated_at: now.toISOString(),
  });
  expect(await reminders().claimDue(now, group)).toEqual([]);
});

test("5分ちょうどは復旧せず、5分超のsendingだけをpendingへ戻す", async () => {
  await register();
  const claimed = await reminders().claimDue(now, group);
  expect(
    await reminders().recoverStale(new Date(now.getTime() + 300_000), group),
  ).toBe(0);
  expect(
    await reminders().recoverStale(new Date(now.getTime() + 300_001), group),
  ).toBe(1);
  const next = await reminders().claimDue(
    new Date(now.getTime() + 300_001),
    group,
  );
  expect(next[0]?.id).toBe(claimed[0]?.id);
  expect(next[0]?.attempts).toBe(0);
  expect(
    await reminders().recoverStale(new Date(now.getTime() + 300_002), group),
  ).toBe(0);
});

test("成功はsentになり、重複完了・送信済み取消・再claimは無変更", async () => {
  await register();
  const [claimed] = await reminders().claimDue(now, group);
  if (!claimed) throw new Error("claimが空です");
  expect(await reminders().markSent(claimed, now)).toBe(true);
  expect(await reminders().markSent(claimed, now)).toBe(false);
  expect(await cancel(group, claimed.id, now)).toBe(false);
  expect(await reminders().claimDue(now, group)).toEqual([]);
  expect(await reminders().listUnsent(group)).toEqual([]);
  const row = await env.DB.prepare(
    "SELECT status, sent_at FROM reminders WHERE id = ?",
  )
    .bind(claimed.id)
    .first();
  expect(row).toEqual({ status: "sent", sent_at: now.toISOString() });
});

test("失敗は1回ずつ加算し、3回でfailedになって再claimしない", async () => {
  await register();
  for (const attempt of [1, 2, 3]) {
    const [claimed] = await reminders().claimDue(now, group);
    if (!claimed) throw new Error("claimが空です");
    expect(await reminders().markFailed(claimed, now)).toBe(true);
    expect(await reminders().markFailed(claimed, now)).toBe(false);
    const rows = await reminders().listUnsent(group);
    expect(rows[0]).toMatchObject({
      attempts: attempt,
      status: attempt === 3 ? "failed" : "pending",
    });
  }
  expect(await reminders().claimDue(now, group)).toEqual([]);
  const [failed] = await reminders().listUnsent(group);
  if (!failed) throw new Error("failedが空です");
  expect(await cancel(group, failed.id, now)).toBe(true);
});

test("復旧・再claim後の古い処理は新しいclaimを上書きしない", async () => {
  await register();
  const [old] = await reminders().claimDue(now, group);
  if (!old) throw new Error("claimが空です");
  const later = new Date(now.getTime() + 300_001);
  await reminders().recoverStale(later, group);
  const [current] = await reminders().claimDue(later, group);
  if (!current) throw new Error("claimが空です");
  expect(await reminders().markSent(old, later)).toBe(false);
  expect(await reminders().markFailed(old, later)).toBe(false);
  expect(await reminders().markSent(current, later)).toBe(true);
});

test("sendingの取消後に遅れて成功・失敗が届いても取消を維持する", async () => {
  await register();
  const [claimed] = await reminders().claimDue(now, group);
  if (!claimed) throw new Error("claimが空です");
  expect(await cancel(group, claimed.id, now)).toBe(true);
  expect(await reminders().markSent(claimed, now)).toBe(false);
  expect(await reminders().markFailed(claimed, now)).toBe(false);
});

test("イベントIDは原子的に一度だけ記録し、未登録IDはnullを返す", async () => {
  expect(await events().get("test-missing-event")).toBeNull();
  const results = await Promise.all([
    events().record("test-event-1", now),
    events().record("test-event-1", now),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await events().get("test-event-1")).toEqual({
    event_id: "test-event-1",
    created_at: now.toISOString(),
  });
});

test("不正な入力時刻はDBを変更せず拒否する", async () => {
  await expect(register("テスト", new Date("invalid"))).rejects.toThrow(
    "D1_TIME_INVALID",
  );
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("同時刻の再claimでも前の処理を拒否する", async () => {
  await register();
  const [old] = await reminders().claimDue(now, group);
  if (!old) throw new Error("claimが空です");
  await reminders().markFailed(old, now);
  const [current] = await reminders().claimDue(now, group);
  if (!current) throw new Error("claimが空です");
  expect(await reminders().markSent(old, now)).toBe(false);
  expect(await reminders().markFailed(old, now)).toBe(false);
  expect(await reminders().markSent(current, now)).toBe(true);
});

test("不正なD1行を内部データとして返さない", async () => {
  await items().add(group, ["テスト品目"], user, now);
  await env.DB.prepare("UPDATE items SET created_at = ? WHERE group_id = ?")
    .bind("invalid", group)
    .run();
  await expect(items().list(group)).rejects.toThrow("D1_ROW_INVALID");
  const row = await register();
  await env.DB.prepare("UPDATE reminders SET remind_at = ? WHERE id = ?")
    .bind("invalid", row.id)
    .run();
  await expect(reminders().listUnsent(group)).rejects.toThrow("D1_ROW_INVALID");
  await events().record("test-event-1", now);
  await env.DB.prepare(
    "UPDATE processed_events SET created_at = ? WHERE event_id = ?",
  )
    .bind("invalid", "test-event-1")
    .run();
  await expect(events().get("test-event-1")).rejects.toThrow("D1_ROW_INVALID");
});

const reply = (text: string, groupId = group) =>
  handleReply(
    { text, groupId, userId: user, now },
    { items: items(), reminders: reminders() },
  );

test("serviceは混在した追加結果を入力順に返し、かな別名の重複も区別する", async () => {
  await items().add(group, ["テスト品目1"], user, now);
  expect(await reply("+テスト品目2 テスト品目1 みるく ミルク")).toBe(
    "追加: テスト品目2、みるく\n登録済み: テスト品目1、ミルク",
  );
  expect(await reply("+テスト品目1")).toBe("登録済み: テスト品目1");
  expect(await reply("+テスト品目1", otherGroup)).toBe("追加: テスト品目1");
  expect(await items().list(group)).toHaveLength(3);
});

test("serviceの削除は入力表示名で結果を分け、照合別名でも1件ずつ消費する", async () => {
  await reply("+ミルク テスト品目");
  expect(await reply("-みるく ミルク 未登録")).toBe(
    "削除: みるく\n見つからない: ミルク、未登録",
  );
  expect(await reply("-未登録")).toBe("見つからない: 未登録");
  expect(await reply("-テスト品目", otherGroup)).toBe(
    "見つからない: テスト品目",
  );
  expect(await reply("-テスト品目")).toBe("削除: テスト品目");
});

test("serviceの買い物一覧は追加順で表示し、空・かなコマンド・グループ分離を扱う", async () => {
  expect(await reply("リスト")).toBe("リストは空です");
  await reply("+テスト品目2 テスト品目1");
  expect(await reply("りすと")).toBe("・テスト品目2\n・テスト品目1");
  expect(await reply("リスト", otherGroup)).toBe("リストは空です");
});

test("serviceの登録・一覧・取消はJST日時と自グループのIDを使う", async () => {
  expect(await reply("リマインド")).toBe("未送信リマインダーはありません");
  expect(await reply("/テスト 明日15時")).toBe(
    "登録: テスト → 10/4(日) 15:00\n取消は「リマインド」の一覧から",
  );
  expect(await reply("リマインド")).toEqual({
    type: "reminder_list",
    reminders: [{ id: 1, content: "テスト", time: "10/4(日) 15:00" }],
    nextOffset: null,
  });
  expect(await reply("リマインド削除 1", otherGroup)).toBeNull();
  expect(await reply("リマインド削除 1")).toBeNull();
  expect(await reminders().listUnsent(group)).toHaveLength(1);
});

test("serviceは長い登録の内容を保持して確認文だけ短縮する", async () => {
  const content = "😀".repeat(3000);
  const response = await reply(`/${content} 明日15時`);
  if (typeof response !== "string")
    throw new Error("テキスト返信ではありません");
  expect(response.length).toBeLessThanOrEqual(5000);
  expect(response).toMatch(/^登録: 😀/u);
  expect(response).toContain(
    "… → 10/4(日) 15:00\n取消は「リマインド」の一覧から",
  );
  expect((await reminders().listUnsent(group))[0]?.content).toBe(content);
  expect(await reply("リマインド")).toEqual({
    type: "reminder_list",
    reminders: [
      { id: 1, content: `${"😀".repeat(149)}…`, time: "10/4(日) 15:00" },
    ],
    nextOffset: null,
  });
});

test("serviceは既存の同名複数行を入力件数分だけ削除する", async () => {
  await reply("+ミルク");
  await env.DB.prepare(
    "INSERT INTO items (group_id, name, norm_name, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(group, "みるく", "ミルク", now.toISOString())
    .run();
  expect(await reply("-みるく ミルク")).toBe("削除: みるく、ミルク");
  expect(await items().list(group)).toEqual([]);
});

test("serviceの長い買い物一覧は行を省略し、件数とUTF-16上限を保つ", async () => {
  const names = Array.from(
    { length: 100 },
    (_, index) => `${index}${"😀".repeat(40)}`,
  );
  await items().add(group, names, null, now);
  const response = await reply("リスト");
  if (typeof response !== "string")
    throw new Error("テキスト返信ではありません");
  const included = response.split("\n").length - 1;
  expect(response.length).toBeLessThanOrEqual(5000);
  expect(response).toBe(
    [
      ...names.slice(0, included).map((name) => `・${name}`),
      `…他${names.length - included}件`,
    ].join("\n"),
  );
  expect(await items().list(group)).toHaveLength(100);
});

test("serviceのリマインダー一覧は期限順で他グループを表示しない", async () => {
  await reply("/後のテスト 明後日");
  await reply("/先のテスト 明日");
  await reply("/別のテスト 明日", otherGroup);
  expect(await reply("リマインド")).toEqual({
    type: "reminder_list",
    reminders: [
      { id: 2, content: "先のテスト", time: "10/4(日) 09:00" },
      { id: 1, content: "後のテスト", time: "10/5(月) 09:00" },
    ],
    nextOffset: null,
  });
});

const testSecret = "test-channel-secret";
const lineReply = vi.fn<ReturnType<typeof createReplyClient>>(async () => {});
const webhookApp = () => createApp({ reply: lineReply, now: () => now });
const bindings = () => ({
  DB: env.DB,
  LINE_CHANNEL_SECRET: testSecret,
  LINE_CHANNEL_ACCESS_TOKEN: "test-access-token",
  ALLOWED_GROUP_ID: group,
});
afterEach(() => {
  vi.restoreAllMocks();
  lineReply.mockClear();
});

function textEvent(text: string, eventId = "test-webhook-1") {
  return {
    type: "message",
    mode: "active",
    timestamp: now.getTime(),
    webhookEventId: eventId,
    deliveryContext: { isRedelivery: false },
    source: { type: "group", groupId: group, userId: user },
    replyToken: "test-reply-token",
    message: { type: "text", id: "test-message-1", text },
  };
}
async function signature(body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(testSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}
async function postEvents(
  events: readonly unknown[],
  settings: WebhookBindings = bindings(),
) {
  const body = JSON.stringify({ destination: "U_test_bot_1", events });
  return webhookApp().fetch(
    new Request("https://example.test/webhook", {
      method: "POST",
      body,
      headers: { "X-Line-Signature": await signature(body) },
    }),
    settings,
  );
}

test("Webhookは署名不正・欠落・本文改変を401にしてDBに触れない", async () => {
  const body = JSON.stringify({ events: [textEvent("+テスト品目")] });
  for (const value of ["", "invalid", await signature(`${body} `)]) {
    const response = await webhookApp().fetch(
      new Request("https://example.test/webhook", {
        method: "POST",
        body,
        headers: { "x-line-signature": value },
      }),
      bindings(),
    );
    expect(response.status).toBe(401);
  }
  expect(await items().list(group)).toEqual([]);
  expect(await events().get("test-webhook-1")).toBeNull();
  expect(lineReply).not.toHaveBeenCalled();
});
// 公式「リクエストボディ」「レスポンス」: eventsの空配列にも200。
test("空eventsと未設定・仮値・別groupは200で無変更、拒否ログはtypeとIDだけ", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  expect((await postEvents([])).status).toBe(200);
  for (const allowed of ["", "<YOUR_ALLOWED_GROUP_ID>", otherGroup])
    expect(
      (
        await postEvents([textEvent("+秘密のテスト本文")], {
          ...bindings(),
          ALLOWED_GROUP_ID: allowed,
        })
      ).status,
    ).toBe(200);
  expect(log).toHaveBeenCalledTimes(3);
  for (const call of log.mock.calls)
    expect(JSON.parse(String(call[0]))).toEqual({
      type: "group",
      groupId: group,
      userId: user,
    });
  expect(await items().list(group)).toEqual([]);
  expect(await events().get("test-webhook-1")).toBeNull();
  expect(lineReply).not.toHaveBeenCalled();
});
test("許可groupのテキストは保存し、同時再送でも登録と返信は1回", async () => {
  const event = textEvent("/テスト 明日15時");
  const responses = await Promise.all([
    postEvents([event]),
    postEvents([{ ...event, deliveryContext: { isRedelivery: true } }]),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(await reminders().listUnsent(group)).toHaveLength(1);
  expect(lineReply).toHaveBeenCalledExactlyOnceWith(
    "test-access-token",
    "test-reply-token",
    "登録: テスト → 10/4(日) 15:00\n取消は「リマインド」の一覧から",
  );
});
test("イベント記録後の業務SQL失敗は全体を戻し、再送で欠落なく処理できる", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await env.DB.exec(
    "CREATE TRIGGER fail_business BEFORE INSERT ON items WHEN NEW.name = 'テスト品目2' BEGIN SELECT RAISE(ABORT, 'TEST_FAILURE'); END;",
  );
  const event = textEvent("+テスト品目1 テスト品目2");
  expect((await postEvents([event])).status).toBe(500);
  expect(await items().list(group)).toEqual([]);
  expect(await events().get(event.webhookEventId)).toBeNull();
  expect(lineReply).not.toHaveBeenCalled();
  await env.DB.exec("DROP TRIGGER fail_business");
  expect((await postEvents([event])).status).toBe(200);
  expect(await items().list(group)).toHaveLength(2);
  expect(await events().get(event.webhookEventId)).not.toBeNull();
});
test("削除の同時再送は古い1件だけを完了する", async () => {
  await items().add(group, ["ミルク"], user, now);
  await env.DB.prepare(
    "INSERT INTO items (group_id, name, norm_name, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(group, "みるく", "ミルク", now.toISOString())
    .run();
  const event = textEvent("-みるく");
  expect(
    (await Promise.all([postEvents([event]), postEvents([event])])).map(
      (r) => r.status,
    ),
  ).toEqual([200, 200]);
  expect(await items().list(group)).toHaveLength(1);
  expect(lineReply).toHaveBeenCalledTimes(1);
});
test("非テキスト・雑談・standby・応答トークン欠落・ユーザー/roomは無変更", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const base = textEvent("+テスト品目");
  const ignored = [
    { ...base, message: { type: "sticker" } },
    textEvent("雑談"),
    { ...base, mode: "standby" },
    { ...base, replyToken: undefined },
    { ...base, source: { type: "user", userId: user } },
    {
      ...base,
      source: { type: "room", roomId: "R_test_room_1", userId: user },
    },
  ];
  expect((await postEvents(ignored)).status).toBe(200);
  expect(await items().list(group)).toEqual([]);
  expect(await events().get(base.webhookEventId)).toBeNull();
  expect(lineReply).not.toHaveBeenCalled();
});
test("Webhookは複数イベントを順に処理し、再送でも一覧・取消・静的返信を重複しない", async () => {
  const input = [
    textEvent("+テスト品目", "test-event-a"),
    textEvent("リスト", "test-event-b"),
    textEvent("ヘルプ", "test-event-c"),
    textEvent("/テスト 明日", "test-event-d"),
    textEvent("リマインド", "test-event-e"),
    buttonEvent("reminder:v1:cancel:1", "test-event-f"),
  ];
  expect((await postEvents(input)).status).toBe(200);
  expect(lineReply).toHaveBeenCalledTimes(6);
  expect((await postEvents(input)).status).toBe(200);
  expect(lineReply).toHaveBeenCalledTimes(6);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("署名済みの生bodyをそのまま検証し、不正JSON/スキーマは400", async () => {
  const bodies = ["{", "{}", '{"events":"invalid"}'];
  for (const body of bodies) {
    const response = await webhookApp().fetch(
      new Request("https://example.test/webhook", {
        method: "POST",
        body,
        headers: { "X-LINE-SIGNATURE": await signature(body) },
      }),
      bindings(),
    );
    expect(response.status).toBe(400);
  }
  const body = `  ${JSON.stringify({ events: [textEvent("＋テスト品目")] })}\n`;
  expect(
    (
      await webhookApp().fetch(
        new Request("https://example.test/webhook", {
          method: "POST",
          body,
          headers: { "X-LINE-SIGNATURE": await signature(body) },
        }),
        bindings(),
      )
    ).status,
  ).toBe(200);
  expect(await items().list(group)).toHaveLength(1);
});
test("未設定secretは401、未設定access tokenは500でDB無変更", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(
    (
      await postEvents([textEvent("+テスト品目")], {
        ...bindings(),
        LINE_CHANNEL_SECRET: "",
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await postEvents([textEvent("+テスト品目")], {
        ...bindings(),
        LINE_CHANNEL_ACCESS_TOKEN: "",
      })
    ).status,
  ).toBe(500);
  expect(await items().list(group)).toEqual([]);
  expect(await events().get("test-webhook-1")).toBeNull();
});
test("Reply失敗でも業務更新を再実行せず、ログは固定コードのみ", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  lineReply.mockRejectedValueOnce(new Error("test-tokenと秘密の本文"));
  const event = textEvent("/テスト 明日15時");
  expect((await postEvents([event])).status).toBe(500);
  expect(await reminders().listUnsent(group)).toHaveLength(1);
  expect(log).toHaveBeenCalledExactlyOnceWith('{"code":"INTERNAL_ERROR"}');
  expect((await postEvents([event])).status).toBe(200);
  expect(await reminders().listUnsent(group)).toHaveLength(1);
  expect(lineReply).toHaveBeenCalledTimes(1);
});

test("group設定自体の欠落とsource欠落も200で無変更", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const settings = {
    DB: env.DB,
    LINE_CHANNEL_SECRET: testSecret,
    LINE_CHANNEL_ACCESS_TOKEN: "test-access-token",
  };
  expect((await postEvents([textEvent("+テスト品目")], settings)).status).toBe(
    200,
  );
  expect((await postEvents([{ type: "join" }])).status).toBe(200);
  expect(log).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({ type: "group", groupId: group, userId: user }),
  );
  expect(await events().get("test-webhook-1")).toBeNull();
});
test("本番配線でもReply fetchをモックし、userId欠落と未知の属性を扱う", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  const event = {
    ...textEvent("+テスト品目"),
    source: { type: "group", groupId: group },
    extra: "test-unused-field",
  };
  const body = JSON.stringify({ events: [event] });
  expect(
    (
      await createApp().fetch(
        new Request("https://example.test/webhook", {
          method: "POST",
          body,
          headers: { "x-line-signature": await signature(body) },
        }),
        bindings(),
      )
    ).status,
  ).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await items().list(group))[0]?.added_by).toBeNull();
});

test("複数イベントの途中失敗後は成功済みを飛ばし、失敗イベントだけ再処理する", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await env.DB.exec(
    "CREATE TRIGGER fail_later BEFORE INSERT ON items WHEN NEW.name = '後のテスト' BEGIN SELECT RAISE(ABORT, 'TEST_FAILURE'); END;",
  );
  const input = [
    textEvent("+先のテスト", "test-event-first"),
    textEvent("+後のテスト", "test-event-later"),
  ];
  expect((await postEvents(input)).status).toBe(500);
  expect(await items().list(group)).toHaveLength(1);
  expect(await events().get("test-event-first")).not.toBeNull();
  expect(await events().get("test-event-later")).toBeNull();
  await env.DB.exec("DROP TRIGGER fail_later");
  expect((await postEvents(input)).status).toBe(200);
  expect(await items().list(group)).toHaveLength(2);
  expect(lineReply).toHaveBeenCalledTimes(2);
});

// 公式「Webhookの署名を検証する」: 独立したopenssl固定ペアで生bodyと署名を照合する。
test("openssl固定署名: 正しいbodyは200、改変・空白追加・ヘッダー欠落は401", async () => {
  const fixed = WEBHOOK_SIGNATURE;
  for (const input of [
    { body: fixed.body, signature: fixed.signature, expected: 200 },
    { body: `${fixed.body} `, signature: fixed.signature, expected: 401 },
    {
      body: fixed.body.replace("U_test_destination", "U_test_changed"),
      signature: fixed.signature,
      expected: 401,
    },
    { body: fixed.body, signature: "", expected: 401 },
  ]) {
    const response = await webhookApp().fetch(
      new Request("https://example.test/webhook", {
        method: "POST",
        body: input.body,
        headers: input.signature ? { "x-line-signature": input.signature } : {},
      }),
      { ...bindings(), LINE_CHANNEL_SECRET: fixed.secret },
    );
    expect(response.status).toBe(input.expected);
  }
  expect(lineReply).not.toHaveBeenCalled();
  expect(await items().list(group)).toEqual([]);
});

const push = vi.fn<Parameters<typeof sendDueReminders>[1]["push"]>(
  async () => {},
);
const cronBindings = {
  ALLOWED_GROUP_ID: group,
  DB: env.DB,
  LINE_CHANNEL_ACCESS_TOKEN: "test-access-token",
};
const cronOptions = (at = now) => ({ push, now: () => at });
const runCron = (at = now) => sendDueReminders(cronBindings, cronOptions(at));

afterEach(() => push.mockReset());

// 公式「プッシュメッセージを送る」「APIリクエストを再試行する」: 永続UUIDを最初から使う。
test("Cronは同時起動でも期限到来分を一度だけ送り、未来・取消を送らない", async () => {
  await register();
  await register("別グループ", now, otherGroup);
  await register("未来", new Date(now.getTime() + 60_000));
  const canceled = await register("取消");
  await cancel(group, canceled.id, now);
  await Promise.all([runCron(), runCron()]);
  expect(push).toHaveBeenCalledTimes(1);
  expect(await reminders().listUnsent(otherGroup)).toMatchObject([
    { status: "pending", retry_key: null, retry_started_at: null },
  ]);
  const calls = push.mock.calls;
  expect(calls).toEqual(
    expect.arrayContaining([
      [
        "test-access-token",
        group,
        "⏰ リマインド: テスト",
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      ],
    ]),
  );
  expect(new Set(calls.map((call) => call[3])).size).toBe(1);
  await runCron();
  expect(push).toHaveBeenCalledTimes(1);
  const rows = await env.DB.prepare(
    "SELECT status, attempts, sent_at FROM reminders WHERE status = ?",
  )
    .bind("sent")
    .all();
  expect(rows.results).toEqual([
    { status: "sent", attempts: 0, sent_at: now.toISOString() },
  ]);
});

test("送信対象がないCronはAPIもログも呼ばず、token欠落・仮値はDBを変えない", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await runCron();
  expect(log).not.toHaveBeenCalled();
  await register();
  for (const token of [undefined, "", "<YOUR_TOKEN>"]) {
    await sendDueReminders(
      {
        DB: env.DB,
        ALLOWED_GROUP_ID: group,
        ...(token === undefined ? {} : { LINE_CHANNEL_ACCESS_TOKEN: token }),
      },
      cronOptions(),
    );
  }
  expect(push).not.toHaveBeenCalled();
  expect((await reminders().listUnsent(group))[0]).toMatchObject({
    status: "pending",
    attempts: 0,
    retry_key: null,
  });
});

test("Cronの失敗は同じキーで再試行し、3回失敗でfailed、429を本文なしで記録する", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await register();
  const fetcher = vi.fn<NonNullable<Parameters<typeof createPushClient>[0]>>(
    async () => ({ ok: false, status: 429, headers: new Headers() }),
  );
  const options = { push: createPushClient(fetcher), now: () => now };
  for (const attempts of [1, 2, 3]) {
    await sendDueReminders(cronBindings, options);
    expect((await reminders().listUnsent(group))[0]).toMatchObject({
      attempts,
      status: attempts === 3 ? "failed" : "pending",
    });
  }
  await sendDueReminders(cronBindings, options);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(
    new Set(
      fetcher.mock.calls.map((call) => call[1].headers["X-Line-Retry-Key"]),
    ).size,
  ).toBe(1);
  expect(log.mock.calls).toEqual(
    Array.from({ length: 3 }, () => [
      '{"code":"LINE_PUSH_RATE_LIMIT","status":429}',
    ]),
  );
});

test("1件のPush失敗でも後続を送り、次回成功ではattemptsを維持する", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await register();
  await register("後続");
  push.mockRejectedValueOnce(new Error("テストの秘密本文"));
  await runCron();
  expect(push).toHaveBeenCalledTimes(2);
  expect((await reminders().listUnsent(group))[0]).toMatchObject({
    attempts: 1,
    status: "pending",
  });
  await runCron(new Date(now.getTime() + 60_000));
  expect(push.mock.calls[2]?.[3]).toBe(push.mock.calls[0]?.[3]);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("sendingは5分超で復旧し、キーを維持して送り、古いclaimは完了できない", async () => {
  await register();
  const [old] = await reminders().claimDue(now, group);
  if (!old) throw new Error("claimが空です");
  await runCron(new Date(now.getTime() + 300_000));
  expect(push).not.toHaveBeenCalled();
  const later = new Date(now.getTime() + 300_001);
  await runCron(later);
  expect(push.mock.calls[0]?.[3]).toBe(old.retry_key);
  expect(await reminders().markFailed(old, later)).toBe(false);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("24時間ちょうど以降の再試行はPushせずfailedにして、キーを更新しない", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await register();
  push.mockRejectedValueOnce(new Error("timeout"));
  await runCron();
  const original = (await reminders().listUnsent(group))[0];
  await runCron(new Date(now.getTime() + 86_400_000));
  expect(push).toHaveBeenCalledTimes(1);
  expect((await reminders().listUnsent(group))[0]).toMatchObject({
    status: "failed",
    attempts: 1,
    retry_key: original?.retry_key,
    retry_started_at: now.toISOString(),
  });
});

test("scheduledハンドラからCronを呼び、既定配線はモックfetchでPushする", async () => {
  await register();
  const controller = {
    scheduledTime: now.getTime(),
    cron: "* * * * *",
    noRetry() {},
  };
  await createScheduled(cronOptions())(controller, cronBindings);
  expect(push).toHaveBeenCalledTimes(1);
  await register("既定配線");
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}", { status: 200 }));
  await worker.scheduled(controller, cronBindings);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("Push受理後のDB完了失敗はsendingを保ち、復旧後の受理済み409でsentになる", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await register();
  await env.DB.exec(
    "CREATE TRIGGER test_sent_failure BEFORE UPDATE OF status ON reminders WHEN NEW.status = 'sent' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  const fetcher = vi.fn<NonNullable<Parameters<typeof createPushClient>[0]>>(
    async () => ({ ok: true, status: 200, headers: new Headers() }),
  );
  const options = { push: createPushClient(fetcher), now: () => now };
  const controller = {
    scheduledTime: now.getTime(),
    cron: "* * * * *",
    noRetry() {},
  };
  await expect(
    createScheduled(options)(controller, cronBindings),
  ).rejects.toThrow("CRON_FAILED");
  expect((await reminders().listUnsent(group))[0]).toMatchObject({
    status: "sending",
    attempts: 0,
  });
  expect(log).toHaveBeenCalledExactlyOnceWith('{"code":"INTERNAL_ERROR"}');
  await env.DB.exec("DROP TRIGGER test_sent_failure");
  fetcher.mockResolvedValue({
    ok: false,
    status: 409,
    headers: new Headers({ "x-line-accepted-request-id": "test-accepted" }),
  });
  await sendDueReminders(cronBindings, {
    ...options,
    now: () => new Date(now.getTime() + 300_001),
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[1].body).toBe(fetcher.mock.calls[0]?.[1].body);
  expect(fetcher.mock.calls[1]?.[1].headers["X-Line-Retry-Key"]).toBe(
    fetcher.mock.calls[0]?.[1].headers["X-Line-Retry-Key"],
  );
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("送信開始前に取消されたclaimを送らず、送信中の取消も遅い結果で上書きしない", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const first = await register("最初");
  const second = await register("取消対象");
  push.mockImplementationOnce(async () => {
    await cancel(group, second.id, now);
  });
  await runCron();
  expect(push).toHaveBeenCalledTimes(1);
  expect(await reminders().listUnsent(group)).toEqual([]);
  expect(first.id).not.toBe(second.id);
  for (const outcome of ["failure", "success"]) {
    const row = await register("送信中取消");
    push.mockImplementationOnce(async () => {
      await cancel(group, row.id, now);
      if (outcome === "failure") throw new Error("テスト本文");
    });
    await runCron();
    expect(await reminders().listUnsent(group)).toEqual([]);
  }
  expect(log).not.toHaveBeenCalled();
});

test("長いPush本文はUTF-16上限内に省略し、24時間未満なら同じ本文で再試行する", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await register("😀".repeat(3000));
  push.mockRejectedValueOnce(new Error("timeout"));
  await runCron();
  await runCron(new Date(now.getTime() + 86_399_999));
  expect(push).toHaveBeenCalledTimes(2);
  const text = push.mock.calls[0]?.[2] ?? "";
  expect(text.length).toBeLessThanOrEqual(5000);
  expect(text).toMatch(/^⏰ リマインド: (😀)+…$/u);
  expect(push.mock.calls[1]).toEqual(push.mock.calls[0]);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("claimバッチの途中失敗でも前の行の状態・キー・開始時刻はロールバックする", async () => {
  await register("最初");
  await register("claim失敗");
  await env.DB.exec(
    "CREATE TRIGGER test_claim_failure BEFORE UPDATE OF status ON reminders WHEN NEW.status = 'sending' AND NEW.content = 'claim失敗' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  await expect(runCron()).rejects.toThrow();
  expect(push).not.toHaveBeenCalled();
  const rows = await reminders().listUnsent(group);
  expect(rows).toHaveLength(2);
  for (const row of rows)
    expect(row).toMatchObject({
      status: "pending",
      retry_key: null,
      retry_started_at: null,
      claim_token: null,
    });
  await env.DB.exec("DROP TRIGGER test_claim_failure");
  await runCron();
  expect(push).toHaveBeenCalledTimes(2);
});

test("不正な月の登録は拒否し、再送でも業務データを作らない", async () => {
  const event = textEvent("/テスト 13/5", "test-invalid-month");
  expect((await postEvents([event])).status).toBe(200);
  expect(await reminders().listUnsent(group)).toEqual([]);
  expect((await postEvents([event])).status).toBe(200);
  expect(await reminders().listUnsent(group)).toEqual([]);
  expect(lineReply).toHaveBeenCalledTimes(1);
});

test("登録失敗はイベント記録も戻し、同時再送では1件だけ登録する", async () => {
  await env.DB.exec(
    "CREATE TRIGGER test_register_failure BEFORE INSERT ON reminders BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  const event = textEvent("/テスト 明日", "test-register-rollback");
  expect((await postEvents([event])).status).toBe(500);
  expect(await events().get("test-register-rollback")).toBeNull();
  expect(await reminders().listUnsent(group)).toEqual([]);
  await env.DB.exec("DROP TRIGGER test_register_failure");
  const responses = await Promise.all([
    postEvents([event]),
    postEvents([event]),
  ]);
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(await reminders().listUnsent(group)).toHaveLength(1);
  expect(lineReply).toHaveBeenCalledTimes(1);
});

test("取消で一覧が空になっても内部IDを再利用せず古いIDは無効", async () => {
  const old = await register();
  if (!old) throw new Error("登録失敗");
  expect(await cancel(group, old.id, now)).toBe(true);
  expect(await reminders().listUnsent(group)).toEqual([]);
  const current = await register();
  if (!current) throw new Error("登録失敗");
  expect(current.id).toBeGreaterThan(old.id);
  expect(await cancel(group, old.id, now)).toBe(false);
  expect(await cancel(otherGroup, current.id, now)).toBe(false);
  expect(await reminders().listUnsent(group)).toHaveLength(1);
});

test("滞留復旧中に旧Pushが完了しても新claimを上書きしない", async () => {
  // 公式「APIリクエストを再試行する」: 復旧時も同じX-Line-Retry-Key。
  await register();
  let started = () => {};
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let complete = () => {};
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  push.mockImplementationOnce(async () => {
    started();
    await pending;
  });
  const oldRun = runCron();
  await entered;
  await runCron(new Date(now.getTime() + 300_001));
  complete();
  await oldRun;
  expect(push).toHaveBeenCalledTimes(2);
  expect(push.mock.calls[0]).toEqual(push.mock.calls[1]);
  const result = await env.DB.prepare(
    "SELECT status, attempts FROM reminders",
  ).all();
  expect(result.results).toEqual([{ status: "sent", attempts: 0 }]);
});

test("初期スキーマからの更新は既存予定と処理済みイベントを保持する", async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, 1));
  await env.DB.prepare(
    "INSERT INTO reminders (group_id, content, remind_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      group,
      "移行テスト",
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  await events().record("test-legacy-event", now);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  expect(
    await env.DB.prepare(
      "SELECT event_id, operation_key FROM processed_events WHERE event_id = ?",
    )
      .bind("test-legacy-event")
      .first(),
  ).toEqual({ event_id: "test-legacy-event", operation_key: null });
  expect(await reminders().listUnsent(group)).toMatchObject([
    {
      content: "移行テスト",
      status: "pending",
      attempts: 0,
      retry_started_at: null,
    },
  ]);
  expect(
    (await postEvents([textEvent("/テスト 明日", "test-legacy-event")])).status,
  ).toBe(200);
  expect(await reminders().listUnsent(group)).toHaveLength(1);
  expect(lineReply).not.toHaveBeenCalled();
  await runCron();
  expect(push).toHaveBeenCalledTimes(1);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test.each([undefined, "", " ", "<ALLOWED_GROUP_ID>", "unset", "U_test_user_1"])(
  "Cronは許可グループが不正ならDBも送信も無操作: %s",
  async (allowed) => {
    await register();
    await reminders().claimDue(now, group);
    await register("未claimの予定");
    const before = await env.DB.prepare("SELECT * FROM reminders").all();
    await sendDueReminders(
      {
        DB: env.DB,
        LINE_CHANNEL_ACCESS_TOKEN: cronBindings.LINE_CHANNEL_ACCESS_TOKEN,
        ...(allowed === undefined ? {} : { ALLOWED_GROUP_ID: allowed }),
      },
      cronOptions(new Date(now.getTime() + 300_001)),
    );
    expect(push).not.toHaveBeenCalled();
    expect(
      (await env.DB.prepare("SELECT * FROM reminders").all()).results,
    ).toEqual(before.results);
  },
);

test("許可変更中は旧予定を保持し、再許可で同じ宛先・本文・キーを復旧送信する", async () => {
  // 公式「プッシュメッセージを送る」「APIリクエストを再試行する」: 宛先とキーを維持。
  await register("旧グループの予定");
  const [old] = await reminders().claimDue(now, group);
  if (!old) throw new Error("claim失敗");
  await register("新グループの予定", now, otherGroup);
  const oldRows = await reminders().listUnsent(group);
  const later = new Date(now.getTime() + 300_001);
  const changed = { ...cronBindings, ALLOWED_GROUP_ID: otherGroup };
  await Promise.all([
    sendDueReminders(changed, cronOptions(later)),
    sendDueReminders(changed, cronOptions(later)),
  ]);
  expect(push).toHaveBeenCalledTimes(1);
  expect(push.mock.calls[0]?.[1]).toBe(otherGroup);
  expect(await reminders().listUnsent(group)).toEqual(oldRows);
  await Promise.all([runCron(later), runCron(later)]);
  expect(push).toHaveBeenCalledTimes(2);
  expect(push.mock.calls[1]).toEqual([
    "test-access-token",
    group,
    "⏰ リマインド: 旧グループの予定",
    old.retry_key,
  ]);
  expect(await reminders().markSent(old, later)).toBe(false);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("Push失敗後に許可が変わっても再許可時の宛先・本文・キーは同一", async () => {
  await register("再送の予定");
  push.mockRejectedValueOnce(new Error("test failure"));
  await runCron();
  const saved = await reminders().listUnsent(group);
  await sendDueReminders(
    { ...cronBindings, ALLOWED_GROUP_ID: otherGroup },
    cronOptions(new Date(now.getTime() + 60_000)),
  );
  expect(push).toHaveBeenCalledTimes(1);
  expect(await reminders().listUnsent(group)).toEqual(saved);
  await runCron(new Date(now.getTime() + 120_000));
  expect(push).toHaveBeenCalledTimes(2);
  expect(push.mock.calls[1]).toEqual(push.mock.calls[0]);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

function buttonEvent(
  data: unknown,
  eventId = "test-button-event",
  groupId = group,
) {
  return {
    ...textEvent("", eventId),
    type: "postback",
    source: { type: "group", groupId, userId: user },
    postback: { data },
  };
}

// 公式「Flex Message」「ポストバックアクション」「ポストバックイベント」。
test("登録確認はテキストで、一覧と取消対象は同じ内部IDを保持する", async () => {
  expect(
    (
      await postEvents([
        textEvent("/ボタンテスト 明日", "test-button-register"),
      ])
    ).status,
  ).toBe(200);
  const [row] = await reminders().listUnsent(group);
  if (!row) throw new Error("登録失敗");
  expect(lineReply.mock.calls[0]).toHaveLength(3);
  expect(typeof lineReply.mock.calls[0]?.[2]).toBe("string");
  expect(
    (await postEvents([textEvent("リマインド", "test-button-list")])).status,
  ).toBe(200);
  expect(lineReply.mock.calls[1]?.[2]).toEqual({
    type: "reminder_list",
    reminders: [{ id: row.id, content: row.content, time: "10/4(日) 09:00" }],
    nextOffset: null,
  });
  expect(
    (await postEvents([buttonEvent(`reminder:v1:cancel:${row.id}`)])).status,
  ).toBe(200);
  expect(await reminders().listUnsent(group)).toEqual([]);
  expect(lineReply.mock.calls[2]?.[2]).toBe(
    "取消: ボタンテスト → 10/4(日) 09:00",
  );
});

test("古い取消ボタンは新予定を取消せず、取消済み・送信済みを区別する", async () => {
  const old = await register();
  await cancel(group, old.id, now);
  const current = await register();
  expect(current.id).toBeGreaterThan(old.id);
  await postEvents([
    buttonEvent(`reminder:v1:cancel:${old.id}`, "test-old-button"),
  ]);
  expect(lineReply.mock.calls[0]?.[2]).toBe(
    "すでに取消済みです: テスト → 10/3(土) 12:00",
  );
  expect(await reminders().listUnsent(group)).toHaveLength(1);
  const [claimed] = await reminders().claimDue(now, group);
  if (!claimed) throw new Error("claim失敗");
  await reminders().markSent(claimed, now);
  await postEvents([
    buttonEvent(`reminder:v1:cancel:${current.id}`, "test-sent-button"),
  ]);
  expect(lineReply.mock.calls[1]?.[2]).toBe(
    "すでに送信済みです: テスト → 10/3(土) 12:00",
  );
});

test("ボタン操作も許可グループ・対象所属を検証し、他所属は情報を出さない", async () => {
  const row = await register("別所属", now, otherGroup);
  await postEvents([
    buttonEvent(
      `reminder:v1:cancel:${row.id}`,
      "test-wrong-source",
      otherGroup,
    ),
  ]);
  expect(lineReply).not.toHaveBeenCalled();
  await postEvents([
    buttonEvent(`reminder:v1:cancel:${row.id}`, "test-wrong-owner"),
  ]);
  expect(lineReply.mock.calls[0]?.[2]).toBe(
    "対象のリマインダーが見つかりません",
  );
  expect(await reminders().listUnsent(otherGroup)).toHaveLength(1);
});

test("取消ボタンの同時再送はイベントと取消を原子的に1回だけ確定する", async () => {
  const row = await register();
  await env.DB.exec(
    "CREATE TRIGGER test_button_failure BEFORE UPDATE ON reminders WHEN NEW.status = 'canceled' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  const event = buttonEvent(
    `reminder:v1:cancel:${row.id}`,
    "test-button-atomic",
  );
  expect((await postEvents([event])).status).toBe(500);
  expect(await events().get("test-button-atomic")).toBeNull();
  expect(await reminders().listUnsent(group)).toHaveLength(1);
  await env.DB.exec("DROP TRIGGER test_button_failure");
  await Promise.all([postEvents([event]), postEvents([event])]);
  expect(lineReply).toHaveBeenCalledTimes(1);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("一覧はページ分けして全予定へ取消ボタンを付け、一覧番号を振り直さない", async () => {
  for (let i = 0; i < 11; i++)
    await register(`ページテスト${i}`, new Date(now.getTime() + i * 60_000));
  await postEvents([textEvent("リマインド", "test-first-page")]);
  expect(lineReply.mock.calls[0]?.[2]).toMatchObject({
    nextOffset: 5,
    reminders: [1, 2, 3, 4, 5].map((id) => ({ id })),
  });
  await postEvents([buttonEvent("reminder:v1:page:5", "test-next-page")]);
  expect(lineReply.mock.calls[1]?.[2]).toMatchObject({
    nextOffset: 10,
    reminders: [6, 7, 8, 9, 10].map((id) => ({ id })),
  });
  await postEvents([buttonEvent("reminder:v1:page:10", "test-last-page")]);
  expect(lineReply.mock.calls[2]?.[2]).toMatchObject({
    nextOffset: null,
    reminders: [{ id: 11 }],
  });
});

test("不正・欠落postback、standby、別source、許可未設定は業務処理しない", async () => {
  const row = await register();
  const data = `reminder:v1:cancel:${row.id}`;
  const event = buttonEvent(data);
  for (const invalid of [
    buttonEvent("x".repeat(301)),
    buttonEvent(null),
    buttonEvent(1),
    buttonEvent("reminder:v1:cancel:01"),
    { ...event, postback: {} },
    { ...event, mode: "standby" },
    { ...event, replyToken: undefined },
    { ...event, webhookEventId: undefined },
    { ...event, source: { type: "user", userId: user } },
  ]) {
    expect((await postEvents([invalid])).status).toBe(200);
  }
  for (const allowed of ["", "unset", "<ALLOWED_GROUP_ID>"]) {
    expect(
      (await postEvents([event], { ...bindings(), ALLOWED_GROUP_ID: allowed }))
        .status,
    ).toBe(200);
  }
  expect(lineReply).not.toHaveBeenCalled();
  expect(await events().get("test-button-event")).toBeNull();
  expect(await reminders().listUnsent(group)).toHaveLength(1);
});

test("取消ボタンはfailed・sendingも取り消し、旧Cron完了で上書きされない", async () => {
  const row = await register();
  const [claimed] = await reminders().claimDue(now, group);
  if (!claimed) throw new Error("claim失敗");
  await postEvents([
    buttonEvent(`reminder:v1:cancel:${row.id}`, "test-cancel-sending"),
  ]);
  expect(await reminders().markSent(claimed, now)).toBe(false);
  expect(await reminders().markFailed(claimed, now)).toBe(false);
  const failed = await register();
  for (let i = 0; i < 3; i++) {
    const [claim] = await reminders().claimDue(now, group);
    if (!claim) throw new Error("claim失敗");
    await reminders().markFailed(claim, now);
  }
  await postEvents([
    buttonEvent(`reminder:v1:cancel:${failed.id}`, "test-cancel-failed"),
  ]);
  expect(await reminders().listUnsent(group)).toEqual([]);
  expect(lineReply.mock.calls.map((call) => call[2])).toEqual([
    "取消: テスト → 10/3(土) 12:00",
    "取消: テスト → 10/3(土) 12:00",
  ]);
});

test("ボタン一覧の長文・空ページ・空一覧でも上限と対象IDを維持する", async () => {
  await postEvents([textEvent("リマインド", "test-empty-buttons")]);
  expect(lineReply.mock.calls[0]?.[2]).toBe("未送信リマインダーはありません");
  for (let i = 0; i < 10; i++) await register("😀".repeat(3000));
  await postEvents([textEvent("リマインド", "test-long-buttons")]);
  const list = lineReply.mock.calls[1]?.[2];
  if (!list || typeof list === "string") throw new Error("一覧なし");
  expect(list.reminders).toHaveLength(5);
  expect(list.nextOffset).toBe(5);
  for (const row of list.reminders) {
    expect(row.content.length).toBeLessThanOrEqual(300);
    expect(row.content).toMatch(/^(😀)+…$/u);
  }
  expect((await reminders().listUnsent(group))[0]?.content.length).toBe(6000);
  await postEvents([
    buttonEvent("reminder:v1:page:9007199254740991", "test-empty-page"),
  ]);
  expect(lineReply.mock.calls[2]?.[2]).toBe(
    "このページの予定はありません。リマインドで一覧を更新してください",
  );
});

test("長い内部IDもボタンへそのまま保持し、手入力なしで取り消す", async () => {
  const row = await register();
  const id = 9007199254740991;
  await env.DB.prepare("UPDATE reminders SET id = ? WHERE id = ?")
    .bind(id, row.id)
    .run();
  await postEvents([textEvent("リマインド", "test-long-id-list")]);
  expect(lineReply.mock.calls[0]?.[2]).toMatchObject({
    type: "reminder_list",
    reminders: [{ id }],
    nextOffset: null,
  });
  await postEvents([
    buttonEvent(`reminder:v1:cancel:${id}`, "test-long-id-cancel"),
  ]);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("ボタン取消のReply失敗後も再送で取消・返信を重複実行しない", async () => {
  const row = await register();
  lineReply.mockRejectedValueOnce(new Error("test reply failure"));
  const event = buttonEvent(
    `reminder:v1:cancel:${row.id}`,
    "test-button-reply-failure",
  );
  expect((await postEvents([event])).status).toBe(500);
  expect(await reminders().listUnsent(group)).toEqual([]);
  expect((await postEvents([event])).status).toBe(200);
  expect(lineReply).toHaveBeenCalledTimes(1);
});

test("取消後の状態照会SQLが失敗しても取消とイベント記録を全体ロールバックする", async () => {
  const row = await register();
  const prepare = env.DB.prepare.bind(env.DB);
  const spy = vi
    .spyOn(env.DB, "prepare")
    .mockImplementation((query) =>
      prepare(
        query.startsWith(
          "SELECT * FROM reminders WHERE group_id = ? AND id = ?",
        )
          ? query.replace("SELECT *", "SELECT missing_test_column")
          : query,
      ),
    );
  const event = buttonEvent(
    `reminder:v1:cancel:${row.id}`,
    "test-button-select-failure",
  );
  expect((await postEvents([event])).status).toBe(500);
  spy.mockRestore();
  expect(await events().get("test-button-select-failure")).toBeNull();
  expect((await reminders().listUnsent(group))[0]?.status).toBe("pending");
  expect((await postEvents([event])).status).toBe(200);
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test("異なるイベントの二重タップは取消成功と取消済みを各1回案内する", async () => {
  const row = await register();
  await Promise.all([
    postEvents([
      buttonEvent(`reminder:v1:cancel:${row.id}`, "test-button-tap-one"),
    ]),
    postEvents([
      buttonEvent(`reminder:v1:cancel:${row.id}`, "test-button-tap-two"),
    ]),
  ]);
  expect(lineReply.mock.calls.map((call) => call[2]).sort()).toEqual(
    [
      "取消: テスト → 10/3(土) 12:00",
      "すでに取消済みです: テスト → 10/3(土) 12:00",
    ].sort(),
  );
  expect(await reminders().listUnsent(group)).toEqual([]);
});

test.each([0, 1, 5, 6, 11])(
  "I2一覧は日時順の構造化5件ページを返す: %i件",
  async (count) => {
    for (let index = count - 1; index >= 0; index--)
      await register(
        `UIテスト${index}`,
        new Date(now.getTime() + index * 60_000),
      );
    await postEvents([textEvent("リマインド", "test-i2-list")]);
    const rows = await reminders().listUnsent(group);
    const expected = rows.slice(0, 5).map((row) => ({
      id: row.id,
      content: row.content,
      time: `10/3(土) 12:${String(count - row.id).padStart(2, "0")}`,
    }));
    expect(lineReply).toHaveBeenCalledExactlyOnceWith(
      "test-access-token",
      "test-reply-token",
      count
        ? {
            type: "reminder_list",
            reminders: expected,
            nextOffset: count > 5 ? 5 : null,
          }
        : "未送信リマインダーはありません",
    );
  },
);

test("I2登録と取消は結果テキストだけで、一覧は自動再送しない", async () => {
  await postEvents([textEvent("/UIテスト 明日", "test-i2-register")]);
  expect(lineReply).toHaveBeenCalledExactlyOnceWith(
    "test-access-token",
    "test-reply-token",
    "登録: UIテスト → 10/4(日) 09:00\n取消は「リマインド」の一覧から",
  );
  lineReply.mockClear();
  await postEvents([buttonEvent("reminder:v1:cancel:1", "test-i2-cancel")]);
  expect(lineReply).toHaveBeenCalledExactlyOnceWith(
    "test-access-token",
    "test-reply-token",
    "取消: UIテスト → 10/4(日) 09:00",
  );
});

test("I2はWebhookからReplyの単一Flexまで内容・日時・対象IDを維持する", async () => {
  for (let index = 6; index >= 1; index--)
    await register(
      `😀一覧テスト #999 ${index}\n2行目\n3行目`,
      new Date(now.getTime() + index * 60_000),
    );
  await register("他所属は非表示", now, otherGroup);
  const fetcher = vi.fn<NonNullable<Parameters<typeof createReplyClient>[0]>>(
    async () => ({ ok: true, status: 200 }),
  );
  lineReply.mockImplementationOnce(createReplyClient(fetcher));
  expect(
    (await postEvents([textEvent("リマインド", "test-i2-flex")])).status,
  ).toBe(200);
  const body = fetcher.mock.calls[0]?.[1].body;
  if (!body) throw new Error("送信なし");
  const rows = (await reminders().listUnsent(group)).slice(0, 5);
  expect(JSON.parse(body)).toMatchObject({
    messages: [
      {
        type: "flex",
        contents: {
          body: {
            contents: rows.map((row, index) => ({
              contents: [
                { type: "text", text: row.content, wrap: true, maxLines: 2 },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "text", text: `10/3(土) 12:0${index + 1}` },
                    {
                      type: "button",
                      action: {
                        label: "取消",
                        data: `reminder:v1:cancel:${row.id}`,
                      },
                    },
                  ],
                },
              ],
            })),
          },
          footer: { contents: [{ action: { data: "reminder:v1:page:5" } }] },
        },
      },
    ],
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("廃止した文字取消コマンドはイベント記録も返信も行わない", async () => {
  await register();
  for (const text of [
    "リマインド削除",
    "リマインド削除 1",
    "リマインド削除 abc",
  ]) {
    expect((await postEvents([textEvent(text)])).status).toBe(200);
  }
  expect(await events().get("test-webhook-1")).toBeNull();
  expect(lineReply).not.toHaveBeenCalled();
  expect(await reminders().listUnsent(group)).toHaveLength(1);
});

test("取消結果は長い内容と利用者の#番号を保持しつつ表示だけを短縮する", async () => {
  const content = `#123 ${"😀".repeat(3000)}`;
  const row = await register(content);
  await postEvents([buttonEvent(`reminder:v1:cancel:${row.id}`)]);
  const response = lineReply.mock.calls[0]?.[2];
  if (typeof response !== "string")
    throw new Error("テキスト返信ではありません");
  expect(response.length).toBeLessThanOrEqual(5000);
  expect(response).toMatch(/^取消: #123 😀/u);
  expect(response).toContain("… → 10/3(土) 12:00");
  expect(response).not.toContain("\uFFFD");
  expect(
    await env.DB.prepare("SELECT content FROM reminders WHERE id = ?")
      .bind(row.id)
      .first("content"),
  ).toBe(content);
});
