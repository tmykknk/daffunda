import type { D1Database } from "@cloudflare/workers-types";
import type * as v from "valibot";
import { MAX_REMINDER_ATTEMPTS, REMINDER_STALE_AFTER_MS } from "../constants";
import {
  type EventScope,
  executeRows,
  executeStatements,
  scopeBindings,
} from "./event-operation";
import { firstRow, parseRows, utcTimestamp } from "./rows";
import { claimedSchema, reminderSchema } from "./schemas";

type ClaimedReminder = v.InferOutput<typeof claimedSchema>;
type NewReminder = Readonly<{
  groupId: string;
  content: string;
  remindAt: Date;
  createdBy: string | null;
  retryKey: string | null;
  now: Date;
}>;

export function createRemindersRepo(db: D1Database, scope?: EventScope) {
  return {
    async create(input: NewReminder) {
      const timestamp = utcTimestamp(input.now);
      const result = await db
        .prepare(
          "INSERT INTO reminders (group_id, content, remind_at, created_by, created_at, retry_key, updated_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE (? IS NULL OR EXISTS (SELECT 1 FROM processed_events WHERE event_id = ? AND operation_key = ?)) RETURNING *",
        )
        .bind(
          input.groupId,
          input.content,
          utcTimestamp(input.remindAt),
          input.createdBy,
          timestamp,
          input.retryKey,
          timestamp,
          ...scopeBindings(scope),
        );
      return firstRow(await executeRows(db, result, reminderSchema, scope));
    },
    async listUnsent(group: string) {
      const result = await db
        .prepare(
          "SELECT * FROM reminders WHERE group_id = ? AND status IN ('pending', 'sending', 'failed') AND (? IS NULL OR EXISTS (SELECT 1 FROM processed_events WHERE event_id = ? AND operation_key = ?)) ORDER BY remind_at, id",
        )
        .bind(group, ...scopeBindings(scope));
      return executeRows(db, result, reminderSchema, scope);
    },
    async cancel(group: string, id: number, now: Date) {
      const result = await db
        .prepare(
          "UPDATE reminders SET status = 'canceled', updated_at = ?, claim_token = NULL WHERE group_id = ? AND id = ? AND status IN ('pending', 'sending', 'failed') AND (? IS NULL OR EXISTS (SELECT 1 FROM processed_events WHERE event_id = ? AND operation_key = ?))",
        )
        .bind(utcTimestamp(now), group, id, ...scopeBindings(scope));
      const results = await executeStatements(db, [result], scope);
      return results[0]?.meta.changes === 1;
    },
    async claimDue(now: Date) {
      const timestamp = utcTimestamp(now);
      const result = await db
        .prepare(
          "UPDATE reminders SET status = 'sending', updated_at = ?, claim_token = ? WHERE status = 'pending' AND remind_at <= ? RETURNING *",
        )
        .bind(timestamp, crypto.randomUUID(), timestamp)
        .all();
      return parseRows(claimedSchema, result.results);
    },
    async recoverStale(now: Date) {
      const timestamp = utcTimestamp(now);
      const cutoff = utcTimestamp(
        new Date(now.getTime() - REMINDER_STALE_AFTER_MS),
      );
      const result = await db
        .prepare(
          "UPDATE reminders SET status = 'pending', updated_at = ?, claim_token = NULL WHERE status = 'sending' AND updated_at < ?",
        )
        .bind(timestamp, cutoff)
        .run();
      return result.meta.changes;
    },
    async markSent(claimed: ClaimedReminder, now: Date) {
      const timestamp = utcTimestamp(now);
      const result = await db
        .prepare(
          "UPDATE reminders SET status = 'sent', sent_at = ?, updated_at = ?, claim_token = NULL WHERE id = ? AND group_id = ? AND status = 'sending' AND claim_token = ?",
        )
        .bind(
          timestamp,
          timestamp,
          claimed.id,
          claimed.group_id,
          claimed.claim_token,
        )
        .run();
      return result.meta.changes === 1;
    },
    async markFailed(claimed: ClaimedReminder, now: Date) {
      const result = await db
        .prepare(
          "UPDATE reminders SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END, updated_at = ?, claim_token = NULL WHERE id = ? AND group_id = ? AND status = 'sending' AND claim_token = ?",
        )
        .bind(
          MAX_REMINDER_ATTEMPTS,
          utcTimestamp(now),
          claimed.id,
          claimed.group_id,
          claimed.claim_token,
        )
        .run();
      return result.meta.changes === 1;
    },
  };
}
