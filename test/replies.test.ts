import { expect, test } from "vitest";
import {
  boundedList,
  formatTokyoTime,
  reminderPushText,
} from "../src/service/replies";
import cases from "./fixtures/text-format-cases.json";

// 公式「テキストメッセージ」: 最大5000 UTF-16符号単位。省略は1メッセージで返す。
test("一覧は5000符号単位ちょうどを省略しない", () => {
  expect(boundedList(["あ".repeat(5000)], "空")).toBe("あ".repeat(5000));
  expect(boundedList([], "空")).toBe("空");
});
test("省略は残り件数を数え、サロゲートペアを切らず行単位で行う", () => {
  const lines = Array.from(
    { length: 50 },
    (_, index) => `${index}: ${"😀".repeat(50)}`,
  );
  const response = boundedList(lines, "空");
  const included = response.split("\n").length - 1;
  expect(response.length).toBeLessThanOrEqual(5000);
  expect(response).toBe(
    [...lines.slice(0, included), `…他${lines.length - included}件`].join("\n"),
  );
  expect(included).toBeGreaterThan(0);
  expect(boundedList(["あ".repeat(5001), "短い"], "空")).toBe("…他2件");
});
test("JSTの深夜・曜日・年月跨ぎもホストTZに依存しない", () => {
  expect(formatTokyoTime("2026-12-31T15:05:00.000Z")).toBe("1/1(金) 00:05");
});

// 公式「テキストメッセージ」: UTF-16の境界と省略前後の本文を固定する。
for (const row of cases) {
  test(`${row.id}: Push文面の上限・接頭辞・省略を維持する`, () => {
    const response = reminderPushText(row.character.repeat(row.repeat));
    expect(response).toBe(
      `⏰ リマインド: ${row.character.repeat(row.pushRepeat)}${row.pushSuffix}`,
    );
    expect(response.length).toBe(row.pushLength);
  });
}
