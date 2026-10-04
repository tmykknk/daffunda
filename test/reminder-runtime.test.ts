import { expect, test } from "vitest";
import { parseReminder } from "../src/domain/reminder-parse";

test("Workersでもchronoの日本語日時解釈がUTCで返る", () => {
  const now = new Date("2026-10-03T12:00:00+09:00");
  expect(parseReminder("テスト 明日15時", now)).toEqual({
    ok: true,
    content: "テスト",
    remindAt: "2026-10-04T06:00:00.000Z",
  });
  expect(parseReminder("テスト 30分後", now)).toEqual({
    ok: true,
    content: "テスト",
    remindAt: "2026-10-03T03:30:00.000Z",
  });
});
