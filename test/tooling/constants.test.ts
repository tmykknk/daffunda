import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEMS_PER_MESSAGE,
  TIME_ZONE,
} from "../../src/constants";

test("定数が仕様の上限とタイムゾーンに一致する", () => {
  const specification = readFileSync("docs/spec.md", "utf8");

  expect(specification).toContain(`${MAX_ITEMS_PER_MESSAGE + 1}品目以上`);
  expect(specification).toContain(`${MAX_ITEM_NAME_LENGTH + 1}文字以上`);
  expect(specification).toContain(TIME_ZONE);
});
