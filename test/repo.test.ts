import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";
import { createItemsRepo } from "../src/repo/items";
import { createEventsRepo } from "../src/repo/processed-events";
import { createRemindersRepo } from "../src/repo/reminders";
import { handleText } from "../src/service/commands";

const group = "C_test_group_1";
const otherGroup = "C_test_group_2";
const user = "U_test_user_1";
const now = new Date("2026-10-03T03:00:00.000Z");
const items = () => createItemsRepo(env.DB);
const reminders = () => createRemindersRepo(env.DB);
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
  expect(await reminders().cancel(otherGroup, row.id, now)).toBe(false);
  expect(await reminders().cancel(group, row.id, now)).toBe(true);
  expect(await reminders().cancel(group, row.id, now)).toBe(false);
  expect(await reminders().cancel(group, 999, now)).toBe(false);
  expect(await reminders().listUnsent(group)).toEqual([]);
  expect(await reminders().claimDue(now)).toEqual([]);
});

test("同時claimは期限到来のpendingを一度だけ取得し、未来と取消を除外する", async () => {
  const due = await register();
  await register("未来", new Date("2026-10-04T00:00:00.000Z"));
  const canceled = await register("取消");
  await reminders().cancel(group, canceled.id, now);
  const claims = (
    await Promise.all([reminders().claimDue(now), reminders().claimDue(now)])
  ).flat();
  expect(claims).toHaveLength(1);
  expect(claims[0]).toMatchObject({
    id: due.id,
    status: "sending",
    updated_at: now.toISOString(),
  });
  expect(await reminders().claimDue(now)).toEqual([]);
});

test("5分ちょうどは復旧せず、5分超のsendingだけをpendingへ戻す", async () => {
  await register();
  const claimed = await reminders().claimDue(now);
  expect(
    await reminders().recoverStale(new Date(now.getTime() + 300_000)),
  ).toBe(0);
  expect(
    await reminders().recoverStale(new Date(now.getTime() + 300_001)),
  ).toBe(1);
  const next = await reminders().claimDue(new Date(now.getTime() + 300_001));
  expect(next[0]?.id).toBe(claimed[0]?.id);
  expect(next[0]?.attempts).toBe(0);
  expect(
    await reminders().recoverStale(new Date(now.getTime() + 300_002)),
  ).toBe(0);
});

test("成功はsentになり、重複完了・送信済み取消・再claimは無変更", async () => {
  await register();
  const [claimed] = await reminders().claimDue(now);
  if (!claimed) throw new Error("claimが空です");
  expect(await reminders().markSent(claimed, now)).toBe(true);
  expect(await reminders().markSent(claimed, now)).toBe(false);
  expect(await reminders().cancel(group, claimed.id, now)).toBe(false);
  expect(await reminders().claimDue(now)).toEqual([]);
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
    const [claimed] = await reminders().claimDue(now);
    if (!claimed) throw new Error("claimが空です");
    expect(await reminders().markFailed(claimed, now)).toBe(true);
    expect(await reminders().markFailed(claimed, now)).toBe(false);
    const rows = await reminders().listUnsent(group);
    expect(rows[0]).toMatchObject({
      attempts: attempt,
      status: attempt === 3 ? "failed" : "pending",
    });
  }
  expect(await reminders().claimDue(now)).toEqual([]);
  const [failed] = await reminders().listUnsent(group);
  if (!failed) throw new Error("failedが空です");
  expect(await reminders().cancel(group, failed.id, now)).toBe(true);
});

test("復旧・再claim後の古い処理は新しいclaimを上書きしない", async () => {
  await register();
  const [old] = await reminders().claimDue(now);
  if (!old) throw new Error("claimが空です");
  const later = new Date(now.getTime() + 300_001);
  await reminders().recoverStale(later);
  const [current] = await reminders().claimDue(later);
  if (!current) throw new Error("claimが空です");
  expect(await reminders().markSent(old, later)).toBe(false);
  expect(await reminders().markFailed(old, later)).toBe(false);
  expect(await reminders().markSent(current, later)).toBe(true);
});

test("sendingの取消後に遅れて成功・失敗が届いても取消を維持する", async () => {
  await register();
  const [claimed] = await reminders().claimDue(now);
  if (!claimed) throw new Error("claimが空です");
  expect(await reminders().cancel(group, claimed.id, now)).toBe(true);
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
  const [old] = await reminders().claimDue(now);
  if (!old) throw new Error("claimが空です");
  await reminders().markFailed(old, now);
  const [current] = await reminders().claimDue(now);
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
  handleText(
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
    "登録 #1: テスト → 10/4(日) 15:00\n取消: リマインド削除 1",
  );
  expect(await reply("リマインド")).toBe("#1 10/4(日) 15:00 テスト");
  expect(await reply("リマインド削除 1", otherGroup)).toBe("見つからない: #1");
  expect(await reply("リマインド削除 1")).toBe("取消: #1");
  expect(await reply("リマインド削除 1")).toBe("見つからない: #1");
  expect(await reply("リマインド")).toBe("未送信リマインダーはありません");
});

test("serviceは長い登録の内容を保持して確認文だけ短縮する", async () => {
  const content = "😀".repeat(3000);
  const response = await reply(`/${content} 明日15時`);
  expect(response?.length).toBeLessThanOrEqual(5000);
  expect(response).toMatch(/^登録 #1: 😀/u);
  expect(response).toContain("… → 10/4(日) 15:00\n取消: リマインド削除 1");
  expect((await reminders().listUnsent(group))[0]?.content).toBe(content);
  expect(await reply("リマインド")).toBe("…他1件");
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
  if (!response) throw new Error("返信が空です");
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
  expect(await reply("リマインド")).toBe(
    "#2 10/4(日) 09:00 先のテスト\n#1 10/5(月) 09:00 後のテスト",
  );
});
