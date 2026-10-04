import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse } from "../../src/domain/parser";

function readCases() {
  const entries: unknown = JSON.parse(
    readFileSync("test/fixtures/parser-cases.json", "utf8"),
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

const cases = readCases();

test.each(cases)("$id: $input", ({ input, expect: expected }) => {
  expect(parse(input)).toEqual(expected);
});

function expandInput(cell: string): string {
  const literals = [...cell.matchAll(/`([^`]*)`/gu)].map(
    (match) => match[1] ?? "",
  );
  if (cell.includes("改行で区切った")) return literals.join("\n");
  const repetition = cell.match(/「(.)」を(\d+)個/u);
  if (repetition)
    return (
      (literals[0] ?? "") + (repetition[1] ?? "").repeat(Number(repetition[2]))
    );
  return literals[0] ?? "";
}

function expandExpectation(cell: string): unknown {
  const [type] = cell.split(" ");
  switch (type) {
    case "add":
    case "remove":
    case "reserved_word": {
      const values: unknown = JSON.parse(cell.match(/\[.*\]/u)?.[0] ?? "null");
      return { type, [type === "reserved_word" ? "words" : "items"]: values };
    }
    case "usage":
      return { type, command: JSON.parse(cell.slice("usage ".length)) };
    case "remind_delete":
      return { type, id: Number(cell.slice("remind_delete ".length)) };
    case "reminder":
      return { type, raw: JSON.parse(cell.slice("reminder raw=".length)) };
    case "list":
    case "help":
    case "remind_list":
    case "limit_error":
    case "ignore":
      return { type };
    default:
      throw new Error(`未知の期待値: ${cell}`);
  }
}

test("fixturesの34行・順序・入力・期待値がMarkdownの表と完全一致する", () => {
  const rows = readFileSync("docs/parser-cases.md", "utf8")
    .split("\n")
    .filter((row) => row.startsWith("| P-"))
    .map((row) => {
      const cells = row.split("|").map((cell) => cell.trim());
      return {
        id: cells[1],
        input: expandInput(cells[2] ?? ""),
        expect: expandExpectation(cells[3] ?? ""),
      };
    });
  expect(rows).toHaveLength(34);
  expect(cases).toEqual(rows);
  expect(new Set(cases.map(({ id }) => id)).size).toBe(34);
});

test.each(["+", "-"])(
  "%sの上限は重複排除後に適用し、20件まで通す",
  (prefix) => {
    const items = Array.from({ length: 20 }, (_, index) => `i${index + 1}`);
    expect(parse(`${prefix}${[...items, items[0]].join(" ")}`)).toEqual({
      type: prefix === "+" ? "add" : "remove",
      items,
    });
    expect(parse(`${prefix}${[...items, "i21"].join(" ")}`)).toEqual({
      type: "limit_error",
    });
  },
);

test.each(["あ", "😀"])(
  "品目名はUnicode文字を50文字まで受け付ける: %s",
  (character) => {
    expect(parse(`+${character.repeat(50)}`)).toEqual({
      type: "add",
      items: [character.repeat(50)],
    });
    expect(parse(`+${character.repeat(51)}`)).toEqual({ type: "limit_error" });
    expect(parse(`-${character.repeat(51)}`)).toEqual({ type: "limit_error" });
  },
);

test("入力の重複排除はNFKC後に行い、かな統一で表示名を変えない", () => {
  expect(parse("+ｱｲｽ アイス みるく ミルク")).toEqual({
    type: "add",
    items: ["アイス", "みるく", "ミルク"],
  });
});

test("予約語は追加でのみ拒否し、該当語を入力順にまとめる", () => {
  expect(parse("+卵 りすと ヘルプ リマインド リスト りすと")).toEqual({
    type: "reserved_word",
    words: ["りすと", "ヘルプ", "リマインド", "リスト"],
  });
  expect(parse("-リスト ヘルプ")).toEqual({
    type: "remove",
    items: ["リスト", "ヘルプ"],
  });
  expect(parse("+リスト追加")).toEqual({ type: "add", items: ["リスト追加"] });
});

test.each(["0", "-1", "+3", "3.0", "3e1", "3abc", "3 4", "9007199254740992"])(
  "取消IDの不正な引数を拒否する: %s",
  (argument) => {
    expect(parse(`リマインド削除 ${argument}`)).toEqual({
      type: "usage",
      command: "remind_delete",
    });
  },
);

test.each([
  "リマインド削除 ３",
  "リマインド削除\t3",
  "リマインド削除\n3",
  "リマインド削除 003",
])("正規化した正の整数の取消IDを受け付ける: %s", (input) => {
  expect(parse(input)).toEqual({ type: "remind_delete", id: 3 });
});

test("取消IDの最大安全整数を受け付ける", () => {
  expect(parse("リマインド削除 9007199254740991")).toEqual({
    type: "remind_delete",
    id: 9007199254740991,
  });
});

test.each([
  "ヘルプください",
  "りすと追加",
  "リマインド一覧",
  "リマインド削除abc",
  "リマインド削除予定",
  " \t\n　",
])("コマンドに一致しない入力は無視する: %s", (input) => {
  expect(parse(input)).toEqual({ type: "ignore" });
});

test.each([
  ["+ \t\n　", "add"],
  ["- \t\n　", "remove"],
  ["／ \t\n　", "reminder"],
])("内容が空のコマンドは使用例になる: %s", (input, command) => {
  expect(parse(input)).toEqual({ type: "usage", command });
});

test("日時解釈前のrawはNFKC・trimだけを行い、内部の空白と改行を残す", () => {
  expect(parse(" ／ 内容　　明日\n１５時  ")).toEqual({
    type: "reminder",
    raw: "内容  明日\n15時",
  });
});
