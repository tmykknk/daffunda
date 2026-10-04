import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse } from "../../src/domain/parser";
import { parseReminder } from "../../src/domain/reminder-parse";

const reference = new Date("2026-10-03T12:00:00+09:00");

function readCases() {
  const entries: unknown = JSON.parse(
    readFileSync("test/fixtures/reminder-cases.json", "utf8"),
  );
  if (!Array.isArray(entries))
    throw new Error("fixturesは配列である必要があります");
  return entries.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !("input" in entry) ||
      typeof entry.input !== "string" ||
      !("expect" in entry)
    )
      throw new Error("fixturesの形式が不正です");
    return { id: entry.id, input: entry.input, expect: entry.expect };
  });
}

function interpret(input: string, now = reference) {
  const command = parse(input);
  expect(command.type).toBe("reminder");
  if (command.type !== "reminder")
    throw new Error("リマインダー入力ではありません");
  const result = parseReminder(command.raw, now);
  if (!result.ok) return result;
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(result.remindAt));
  return { ...result, remindAt: parts.replace(" ", "T") };
}

const cases = readCases();
test.each(cases)("$id: $input", ({ input, expect: expected }) => {
  expect(interpret(input)).toEqual(expected);
});

test("fixturesの全33行・順序・入力・期待値がMarkdownに一致する", () => {
  const rows = readFileSync("docs/reminder-cases.md", "utf8")
    .split("\n")
    .filter((row) => row.startsWith("| R-"))
    .map((row) => {
      const cells = row.split("|").map((cell) => cell.trim());
      const expected = cells[3] ?? "";
      const [content, at] = expected.slice(3).split(" / ");
      return {
        id: cells[1],
        input: cells[2]?.match(/`([^`]*)`/u)?.[1],
        expect: expected.startsWith("ok ")
          ? { ok: true, content, remindAt: at?.replace(" ", "T") }
          : { ok: false, code: expected.slice("error ".length) },
      };
    });
  expect(rows).toHaveLength(33);
  expect(cases).toEqual(rows);
  expect(new Set(cases.map(({ id }) => id)).size).toBe(33);
});

test.each([
  ["/テスト 明日昼", "2026-10-04T12:00"],
  ["/テスト 明日の夜", "2026-10-04T20:00"],
  ["/テスト 1時", "2026-10-03T13:00"],
  ["/テスト 5時", "2026-10-03T17:00"],
  ["/テスト 6時", "2026-10-04T06:00"],
  ["/テスト 11時", "2026-10-04T11:00"],
  ["/テスト 12時", "2026-10-04T12:00"],
  ["/テスト 23時", "2026-10-03T23:00"],
  ["/テスト 0時", "2026-10-04T00:00"],
  ["/テスト 24時", "2026-10-04T00:00"],
  ["/テスト 午前3時", "2026-10-04T03:00"],
  ["/テスト 午後12時", "2026-10-04T12:00"],
  ["/テスト 3日後15時", "2026-10-06T15:00"],
  ["/テスト 土曜", "2026-10-10T09:00"],
  ["/テスト 日曜", "2026-10-04T09:00"],
  ["/テスト 今週日曜", "2026-10-04T09:00"],
  ["/テスト 毎週月曜", "2026-10-05T09:00"],
  ["/テスト 2027/10/3 12時", "2027-10-03T12:00"],
])("補完ルールの境界: %s", (input, remindAt) => {
  expect(interpret(input)).toEqual({ ok: true, content: "テスト", remindAt });
});

test.each([
  ["/テスト そのうち", "UNPARSEABLE"],
  ["/テスト 2/30", "UNPARSEABLE"],
  ["/テスト 25時", "UNPARSEABLE"],
  ["/テスト 15:90", "UNPARSEABLE"],
  ["/テスト 明日から明後日", "MULTIPLE"],
  ["/テスト 明日 そのうち", "UNPARSEABLE"],
  ["/テスト 明日25時", "UNPARSEABLE"],
  ["/テスト 2027/10/3 12:01", "TOO_FAR"],
])("安全側に拒否する: %s", (input, code) => {
  expect(interpret(input)).toEqual({ ok: false, code });
});

test.each([
  ["/テスト 来週月曜", "2026-10-05T12:00:00+09:00", "2026-10-12T09:00"],
  ["/テスト 再来週日曜", "2026-10-05T12:00:00+09:00", "2026-10-25T09:00"],
  ["/テスト 月末", "2028-02-01T12:00:00+09:00", "2028-02-29T09:00"],
  ["/テスト 30分後", "2026-12-31T23:50:45+09:00", "2027-01-01T00:20"],
  ["/テスト 10/5", "2026-10-05T12:00:00+09:00", "2027-10-05T09:00"],
])("基準日の境界: %s / %s", (input, now, remindAt) => {
  const instant = new Date(now);
  expect(interpret(input, instant)).toEqual({
    ok: true,
    content: "テスト",
    remindAt,
  });
  expect(instant.toISOString()).toBe(new Date(now).toISOString());
});

test("月末の時刻が過去なら翌月に送らずPASTになる", () => {
  expect(
    interpret("/テスト 月末", new Date("2026-10-31T12:00:00+09:00")),
  ).toEqual({ ok: false, code: "PAST" });
});

test("結果は分精度のUTC ISO8601で返す", () => {
  expect(parseReminder("テスト 明日15時", reference)).toEqual({
    ok: true,
    content: "テスト",
    remindAt: "2026-10-04T06:00:00.000Z",
  });
});

test("不正なnowと空入力はthrowせずエラーになる", () => {
  expect(parseReminder("テスト 明日", new Date("invalid"))).toEqual({
    ok: false,
    code: "UNPARSEABLE",
  });
  expect(parseReminder("", reference)).toEqual({
    ok: false,
    code: "NO_CONTENT",
  });
});

test("月日のみの2/29は次のうるう年が1年以内なら受け付ける", () => {
  expect(
    interpret("/テスト 2/29", new Date("2027-03-01T12:00:00+09:00")),
  ).toEqual({ ok: true, content: "テスト", remindAt: "2028-02-29T09:00" });
});

test("2/29を存在しない翌年の3/1へ暗黙に変えない", () => {
  expect(
    interpret("/テスト 2/29", new Date("2028-03-01T12:00:00+09:00")),
  ).toEqual({ ok: false, code: "UNPARSEABLE" });
});

test("うるう日の1年上限は翌年2/28の同時刻とする", () => {
  const now = new Date("2028-02-29T12:00:00+09:00");
  expect(interpret("/テスト 2029/2/28 12時", now)).toEqual({
    ok: true,
    content: "テスト",
    remindAt: "2029-02-28T12:00",
  });
  expect(interpret("/テスト 2029/2/28 12:01", now)).toEqual({
    ok: false,
    code: "TOO_FAR",
  });
});
