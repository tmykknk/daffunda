import { expect, test } from "vitest";
import { formatTokyoTime, reminderPushText } from "../src/service/replies";
import cases from "./fixtures/text-format-cases.json";

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
