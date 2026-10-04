import { expect, test } from "vitest";
import { boundedList, formatTokyoTime } from "../src/service/replies";

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
