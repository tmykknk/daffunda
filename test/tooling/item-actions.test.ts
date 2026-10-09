import { readFileSync } from "node:fs";
import * as v from "valibot";
import { expect, test } from "vitest";
import { itemActionData, parseItemAction } from "../../src/domain/item-action";

const cases = v.parse(
  v.object({
    valid: v.array(
      v.object({
        data: v.string(),
        expect: v.variant("type", [
          v.object({ type: v.literal("remove_item"), id: v.number() }),
          v.object({ type: v.literal("item_page"), offset: v.number() }),
        ]),
      }),
    ),
    invalid: v.array(v.string()),
  }),
  JSON.parse(readFileSync("test/fixtures/item-actions.json", "utf8")),
);

test.each(cases.valid)(
  "買い物actionはID/offsetとバージョンを保持する: $data",
  ({ data, expect: action }) => {
    expect(parseItemAction(data)).toEqual(action);
    expect(itemActionData(action)).toBe(data);
  },
);
test.each(cases.invalid)("不正な買い物actionは無視する: %s", (data) => {
  expect(parseItemAction(data)).toBeNull();
});
