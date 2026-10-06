import * as v from "valibot";

const text = v.pipe(v.string(), v.minLength(1));
const source = v.object({
  type: v.picklist(["group", "user", "room"]),
  groupId: v.optional(text),
  userId: v.optional(text),
  roomId: v.optional(text),
});
// 公式「Webhookイベントオブジェクト」「送信元」「テキスト」: 未使用の属性は保持しない。
export const webhookSchema = v.object({
  events: v.array(
    v.object({
      type: text,
      source: v.optional(source),
      mode: v.optional(v.picklist(["active", "standby"])),
      webhookEventId: v.optional(text),
      replyToken: v.optional(text),
      message: v.optional(v.unknown()),
    }),
  ),
});
export const textMessageSchema = v.object({
  type: v.literal("text"),
  text: v.string(),
});
export type WebhookEvent = v.InferOutput<
  typeof webhookSchema
>["events"][number];

export function configured(value: string | undefined): value is string {
  return Boolean(value?.trim()) && !/[<>]/u.test(value ?? "");
}
