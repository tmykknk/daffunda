import type { D1Database } from "@cloudflare/workers-types";
import { Hono } from "hono";
import { logError } from "./logger";
import { MESSAGES } from "./messages";

const app = new Hono<{ Bindings: { readonly DB: D1Database } }>();

app.get("/health", (context) => context.text(MESSAGES.health));

app.onError((_error, context) => {
  logError("INTERNAL_ERROR");
  return context.text(MESSAGES.internalError, 500);
});

export default app;
