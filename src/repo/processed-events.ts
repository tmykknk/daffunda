import type { D1Database } from "@cloudflare/workers-types";
import { parseRows, utcTimestamp } from "./rows";
import { eventSchema } from "./schemas";

export function createEventsRepo(db: D1Database) {
  return {
    async record(eventId: string, now: Date) {
      const result = await db
        .prepare(
          "INSERT INTO processed_events (event_id, created_at) VALUES (?, ?) ON CONFLICT (event_id) DO NOTHING RETURNING *",
        )
        .bind(eventId, utcTimestamp(now))
        .all();
      return parseRows(eventSchema, result.results).length === 1;
    },
    async get(eventId: string) {
      const result = await db
        .prepare("SELECT * FROM processed_events WHERE event_id = ?")
        .bind(eventId)
        .all();
      return parseRows(eventSchema, result.results)[0] ?? null;
    },
  };
}
