import { readFileSync } from "node:fs";
import * as v from "valibot";
import { expect, test } from "vitest";
import { parse } from "../../src/domain/parser";
import { parseReminder } from "../../src/domain/reminder-parse";

const cases = v.parse(
  v.object({
    invalid: v.array(v.string()),
    valid: v.array(
      v.object({
        input: v.string(),
        now: v.string(),
        content: v.string(),
        remindAt: v.string(),
      }),
    ),
  }),
  JSON.parse(readFileSync("test/fixtures/numeric-dates.json", "utf8")),
);
const reference = new Date("2026-10-03T12:00:00+09:00");

function interpret(input: string, now: Date) {
  const command = parse(input);
  expect(command.type).toBe("reminder");
  if (command.type !== "reminder")
    throw new Error("リマインダー入力ではありません");
  return parseReminder(command.raw, now);
}

test.each(cases.invalid)(
  "不正な数値日付を部分解釈せず拒否する: %s",
  (input) => {
    expect(interpret(input, reference)).toEqual({
      ok: false,
      code: "UNPARSEABLE",
    });
  },
);
test.each(cases.valid)(
  "正常な数値日付と年補完を維持する: $input / $now",
  ({ input, now, content, remindAt }) => {
    expect(interpret(input, new Date(now))).toEqual({
      ok: true,
      content,
      remindAt,
    });
  },
);
