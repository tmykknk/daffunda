import { expect, test } from "vitest";
import { normalizeName, normalizeText } from "../src/domain/normalize";

test.each([
  ["　＋ｱｲｽ　－１２／　", "+アイス -12/"],
  ["\t 牛乳\nパン \r\n", "牛乳\nパン"],
  ["か\u3099", "が"],
  ["", ""],
  [" 　 \n", ""],
])("入力テキストをNFKC正規化してtrimする: %s", (input, expected) => {
  expect(normalizeText(input)).toBe(expected);
  expect(normalizeText(normalizeText(input))).toBe(expected);
});

test.each([
  ["　みるく　", "ミルク"],
  ["ﾐﾙｸ", "ミルク"],
  ["がぎぐげごぱぴぷぺぽ", "ガギグゲゴパピプペポ"],
  ["ぁぃぅぇぉっゃゅょゎゔゕゖ", "ァィゥェォッャュョヮヴヵヶ"],
  ["ゝゞ", "ヽヾ"],
  ["ゟ", "ヨリ"],
  ["牛乳ABC😀ー", "牛乳ABC😀ー"],
  ["", ""],
])("照合名はひらがなをカタカナに統一する: %s", (input, expected) => {
  expect(normalizeName(input)).toBe(expected);
  expect(normalizeName(normalizeName(input))).toBe(expected);
});
