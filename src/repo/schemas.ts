import * as v from "valibot";
import { MAX_REMINDER_ATTEMPTS } from "../constants";

const text = v.pipe(v.string(), v.minLength(1));
const time = v.pipe(v.string(), v.isoTimestamp());
const id = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(Number.MAX_SAFE_INTEGER),
);
export const itemSchema = v.pipe(
  v.object({
    id,
    group_id: text,
    name: text,
    norm_name: text,
    added_by: v.nullable(text),
    created_at: time,
    done_at: v.nullable(time),
  }),
  v.readonly(),
);
const reminderFields = {
  id,
  group_id: text,
  content: text,
  remind_at: time,
  created_by: v.nullable(text),
  created_at: time,
  attempts: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(0),
    v.maxValue(MAX_REMINDER_ATTEMPTS),
  ),
  retry_key: v.nullable(text),
  retry_started_at: v.nullable(time),
  sent_at: v.nullable(time),
  updated_at: v.nullable(time),
};
export const reminderSchema = v.pipe(
  v.object({
    ...reminderFields,
    status: v.picklist(["pending", "sending", "sent", "failed", "canceled"]),
    claim_token: v.nullable(text),
  }),
  v.readonly(),
);
export const claimedSchema = v.pipe(
  v.object({
    ...reminderFields,
    status: v.literal("sending"),
    claim_token: text,
    retry_key: text,
    retry_started_at: time,
  }),
  v.readonly(),
);
export const eventSchema = v.pipe(
  v.object({ event_id: text, created_at: time }),
  v.readonly(),
);
