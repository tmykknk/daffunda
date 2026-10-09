import { readFileSync } from "node:fs";
import * as v from "valibot";
import { expect, test, vi } from "vitest";
import { handleReply } from "../../src/service/commands";

const cases = v.parse(
  v.array(v.object({ input: v.string(), expect: v.nullable(v.string()) })),
  JSON.parse(readFileSync("test/fixtures/service-cases.json", "utf8")),
);
const now = new Date("2026-10-03T03:00:00.000Z");
const unavailable = vi.fn((): never => {
  throw new Error("DBに触れてはいけません");
});
const repos = {
  items: { add: unavailable, remove: unavailable, list: unavailable },
  reminders: {
    create: unavailable,
    listUnsent: unavailable,
    cancel: unavailable,
    claimDue: unavailable,
    recoverStale: unavailable,
    markSent: unavailable,
    markFailed: unavailable,
  },
};

for (const row of cases) {
  test(`serviceの静的応答: ${row.input.slice(0, 24)}`, async () => {
    expect(
      await handleReply(
        { text: row.input, groupId: "C_test_group_1", userId: null, now },
        repos,
      ),
    ).toBe(row.expect);
  });
}
test("ヘルプには全コマンドと単発リマインダーの説明を含める", async () => {
  const response = await handleReply(
    { text: "ヘルプ", groupId: "C_test_group_1", userId: null, now },
    repos,
  );
  for (const command of ["+", "-", "リスト", "リマインド", "ヘルプ", "単発"])
    expect(response).toContain(command);
  expect(response).not.toContain("リマインド削除");
  expect(unavailable).not.toHaveBeenCalled();
});

test("DBエラーは成功返信へ変換せず呼び出し元へ伝える", async () => {
  await expect(
    handleReply(
      { text: "+テスト品目", groupId: "C_test_group_1", userId: null, now },
      repos,
    ),
  ).rejects.toThrow("DBに触れてはいけません");
});

test("serviceは雑談を無視し、日時エラーはテキストだけ返す", async () => {
  unavailable.mockClear();
  const input = { groupId: "C_test_group_1", userId: null, now };
  expect(await handleReply({ ...input, text: "テスト雑談" }, repos)).toBeNull();
  expect(await handleReply({ ...input, text: "/テスト 昨日" }, repos)).toBe(
    "過去の日時は登録できません",
  );
  expect(unavailable).not.toHaveBeenCalled();
});
