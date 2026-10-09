import type { D1Database } from "@cloudflare/workers-types";
import * as v from "valibot";
import { HTTP_STATUS } from "../constants";
import { parseItemAction } from "../domain/item-action";
import { parse } from "../domain/parser";
import { parseReminderAction } from "../domain/reminder-action";
import type { Reply } from "../domain/reply";
import type { createReplyClient } from "../line/reply";
import { verifySignature } from "../line/verify";
import {
  configured,
  postbackSchema,
  textMessageSchema,
  type WebhookEvent,
  webhookSchema,
} from "../line/webhook-schema";
import { logRejected } from "../logger";
import { DuplicateEvent } from "../repo/event-operation";
import { createWebhookRepos } from "../repo/webhook-repos";
import { handleReply } from "./commands";
import { handleItemAction } from "./item-actions";
import { handleReminderAction } from "./reminder-actions";

export type WebhookBindings = Readonly<{
  DB: D1Database;
  LINE_CHANNEL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  ALLOWED_GROUP_ID?: string;
}>;
export type WebhookOptions = Readonly<{
  reply: ReturnType<typeof createReplyClient>;
  now: () => Date;
}>;
type CommandEvent = Readonly<{
  payload:
    | NonNullable<ReturnType<typeof parseReminderAction>>
    | NonNullable<ReturnType<typeof parseItemAction>>
    | Readonly<{ type: "text"; text: string }>;
  groupId: string;
  userId: string | null;
  eventId: string;
  replyToken: string;
}>;

function permitted(event: WebhookEvent, allowed: string | undefined): boolean {
  const source = event.source;
  if (
    configured(allowed) &&
    allowed.startsWith("C") &&
    source?.type === "group" &&
    source.groupId === allowed
  )
    return true;
  if (source) logRejected(source);
  return false;
}

// 公式「ポストバックイベント」「共通プロパティ」: 操作も署名・active・所属検証を通す。
function commandPayload(event: WebhookEvent): CommandEvent["payload"] | null {
  if (event.type === "postback") {
    const decoded = v.safeParse(postbackSchema, event.postback);
    return decoded.success
      ? (parseReminderAction(decoded.output.data) ??
          parseItemAction(decoded.output.data))
      : null;
  }
  if (event.type !== "message") return null;
  const parsed = v.safeParse(textMessageSchema, event.message);
  return parsed.success && parse(parsed.output.text).type !== "ignore"
    ? { type: "text", text: parsed.output.text }
    : null;
}

async function handleEvent(
  event: WebhookEvent,
  env: WebhookBindings,
  options: WebhookOptions,
): Promise<void> {
  if (!permitted(event, env.ALLOWED_GROUP_ID)) return;
  if (
    event.mode !== "active" ||
    !event.webhookEventId ||
    !event.replyToken ||
    !event.source?.groupId
  )
    return;
  const payload = commandPayload(event);
  if (!payload) return;
  await respondToCommand(
    {
      payload,
      groupId: event.source.groupId,
      userId: event.source.userId ?? null,
      eventId: event.webhookEventId,
      replyToken: event.replyToken,
    },
    env,
    options,
  );
}

// 公式「応答メッセージを送る」: 業務確定後、受信したtokenを速やかに一度だけ使う。
async function respondToCommand(
  event: CommandEvent,
  env: WebhookBindings,
  options: WebhookOptions,
): Promise<void> {
  if (!configured(env.LINE_CHANNEL_ACCESS_TOKEN))
    throw new Error("LINE_TOKEN_MISSING");
  const now = options.now();
  const repos = createWebhookRepos(env.DB, event.eventId, now);
  try {
    const input = { groupId: event.groupId, userId: event.userId, now };
    let reply: Reply | null;
    switch (event.payload.type) {
      case "text":
        reply = await handleReply(
          { ...input, text: event.payload.text },
          repos,
        );
        break;
      case "remove_item":
      case "item_page":
        reply = await handleItemAction(event.payload, input, repos.items);
        break;
      default:
        reply = await handleReminderAction(
          event.payload,
          input,
          repos.reminders,
        );
    }
    await repos.finish();
    if (reply)
      await options.reply(
        env.LINE_CHANNEL_ACCESS_TOKEN,
        event.replyToken,
        reply,
      );
  } catch (error) {
    if (!(error instanceof DuplicateEvent)) throw error;
  }
}

export async function receiveWebhook(
  request: Request,
  env: WebhookBindings,
  options: WebhookOptions,
): Promise<200 | 400 | 401> {
  const body = await request.arrayBuffer();
  if (
    !configured(env.LINE_CHANNEL_SECRET) ||
    !(await verifySignature(
      body,
      request.headers.get("x-line-signature") ?? "",
      env.LINE_CHANNEL_SECRET,
    ))
  )
    return HTTP_STATUS.unauthorized;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return HTTP_STATUS.badRequest;
  }
  const decoded = v.safeParse(webhookSchema, payload);
  if (!decoded.success) return HTTP_STATUS.badRequest;
  for (const event of decoded.output.events)
    await handleEvent(event, env, options);
  return HTTP_STATUS.ok;
}
