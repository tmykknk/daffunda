import type { D1Database } from "@cloudflare/workers-types";
import * as v from "valibot";
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
  if (!configured(env.LINE_CHANNEL_ACCESS_TOKEN))
    throw new Error("LINE_TOKEN_MISSING");
  const now = options.now();
  const repos = createWebhookRepos(env.DB, event.webhookEventId, now);
  try {
    const text = await handleText(
      {
        text: parsed.output.text,
        groupId: event.source.groupId,
        userId: event.source.userId ?? null,
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
    return 401;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return 400;
  }
  const decoded = v.safeParse(webhookSchema, payload);
  if (!decoded.success) return 400;
  for (const event of decoded.output.events)
    await handleEvent(event, env, options);
  return 200;
}
