import { readFileSync } from "node:fs";
import * as v from "valibot";
import { expect, test } from "vitest";
import {
  parseReminderAction,
  reminderActionData,
} from "../../src/domain/reminder-action";

const actionSchema = v.variant("type", [
  v.object({ type: v.literal("cancel"), id: v.number() }),
  v.object({ type: v.literal("page"), offset: v.number() }),
]);
const cases = v.parse(
  v.object({
    valid: v.array(v.object({ data: v.string(), expect: actionSchema })),
    invalid: v.array(v.string()),
  }),
  JSON.parse(readFileSync("test/fixtures/reminder-actions.json", "utf8")),
);

test.each(cases.valid)(
  "バージョン付きactionと内部IDを保持する: $data",
  ({ data, expect: action }) => {
    expect(parseReminderAction(data)).toEqual(action);
    expect(reminderActionData(action)).toBe(data);
  },
);
test.each(cases.invalid)(
  "不正actionを部分解釈・正規化せず拒否する: %s",
  (data) => {
    expect(parseReminderAction(data)).toBeNull();
  },
);
