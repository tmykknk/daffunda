import type { D1Database } from "@cloudflare/workers-types";
import * as v from "valibot";
import { HTTP_STATUS } from "../constants";
import { parse } from "../domain/parser";
import type { createReplyClient } from "../line/reply";
import { verifySignature } from "../line/verify";
import {
  configured,
  textMessageSchema,
  type WebhookEvent,
  webhookSchema,
} from "../line/webhook-schema";
import { logRejected } from "../logger";
import { DuplicateEvent } from "../repo/event-operation";
import { createWebhookRepos } from "../repo/webhook-repos";
import { handleText } from "./commands";

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
  text: string;
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

async function handleEvent(
  event: WebhookEvent,
  env: WebhookBindings,
  options: WebhookOptions,
): Promise<void> {
  if (!permitted(event, env.ALLOWED_GROUP_ID)) return;
  if (
    event.type !== "message" ||
    event.mode !== "active" ||
    !event.webhookEventId ||
    !event.replyToken ||
    !event.source?.groupId
  )
    return;
  const parsed = v.safeParse(textMessageSchema, event.message);
  if (!parsed.success || parse(parsed.output.text).type === "ignore") return;
  await respondToCommand(
    {
      text: parsed.output.text,
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
    const text = await handleText(
      {
        text: event.text,
        groupId: event.groupId,
        userId: event.userId,
        now,
      },
      repos,
    );
    await repos.finish();
    if (text)
      await options.reply(
        env.LINE_CHANNEL_ACCESS_TOKEN,
        event.replyToken,
        text,
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
