import type { D1Database } from "@cloudflare/workers-types";
import { type EventScope, executeStatements } from "./event-operation";
import { createItemsRepo } from "./items";
import { createRemindersRepo } from "./reminders";

export function createWebhookRepos(db: D1Database, eventId: string, now: Date) {
  let completed = false;
  const scope: EventScope = {
    eventId,
    now,
    operationKey: crypto.randomUUID(),
    completed: () => {
      completed = true;
    },
  };
  const reminders = createRemindersRepo(db, scope);
  return {
    items: createItemsRepo(db, scope),
    reminders: {
      create: reminders.create,
      listUnsent: reminders.listUnsent,
      cancelForButton: reminders.cancelForButton,
    },
    async finish() {
      if (!completed) await executeStatements(db, [], scope);
    },
  };
}
