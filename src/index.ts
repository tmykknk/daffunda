import { Hono } from "hono";
import { createReplyClient } from "./line/reply";
import { logError } from "./logger";
import { MESSAGES } from "./messages";
import {
  receiveWebhook,
  type WebhookBindings,
  type WebhookOptions,
} from "./service/webhook";

export function createApp(
  options: WebhookOptions = {
    reply: createReplyClient(),
    now: () => new Date(),
  },
) {
  const app = new Hono<{ Bindings: WebhookBindings }>();
  app.get("/health", (context) => context.text(MESSAGES.health));
  app.post("/webhook", async (context) => {
    const status = await receiveWebhook(context.req.raw, context.env, options);
    return context.newResponse(null, status);
  });
  app.onError((_error, context) => {
    logError("INTERNAL_ERROR");
    return context.text(MESSAGES.internalError, 500);
  });
  return app;
}

export default createApp();
