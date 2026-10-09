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

type CancellationResult =
  | Readonly<{ status: "missing" }>
  | Readonly<{
      status: "canceled" | "alreadyCanceled" | "alreadySent";
      content: string;
      remindAt: string;
    }>;

type ClaimedReminder = v.InferOutput<typeof claimedSchema>;
type NewReminder = Readonly<{
  groupId: string;
  content: string;
  remindAt: Date;
  createdBy: string | null;
  retryKey: string | null;
  now: Date;
}>;

function prepareReminderClaim(
  db: D1Database,
  id: number,
  timestamp: string,
  group: string,
) {
  // 各行に独立したUUIDをbindし、同時Cronでもpendingを取れたバッチだけが所有する。
  return db
    .prepare(
      "UPDATE reminders SET status = 'sending', updated_at = ?, claim_token = ?, retry_key = COALESCE(retry_key, ?), retry_started_at = COALESCE(retry_started_at, ?) WHERE id = ? AND status = 'pending' AND remind_at <= ? AND group_id = ? RETURNING *",
    )
    .bind(
      timestamp,
      crypto.randomUUID(),
      crypto.randomUUID(),
      timestamp,
      id,
      timestamp,
      group,
    );
}

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
    async cancelForButton(
      group: string,
      id: number,
      now: Date,
    ): Promise<CancellationResult> {
      const update = db
        .prepare(
          "UPDATE reminders SET status = 'canceled', updated_at = ?, claim_token = NULL WHERE group_id = ? AND id = ? AND status IN ('pending', 'sending', 'failed') AND (? IS NULL OR EXISTS (SELECT 1 FROM processed_events WHERE event_id = ? AND operation_key = ?))",
        )
        .bind(utcTimestamp(now), group, id, ...scopeBindings(scope));
      const select = db
        .prepare(
          "SELECT * FROM reminders WHERE group_id = ? AND id = ? AND (? IS NULL OR EXISTS (SELECT 1 FROM processed_events WHERE event_id = ? AND operation_key = ?))",
        )
        .bind(group, id, ...scopeBindings(scope));
      // 状態案内もイベント記録・取消と同じバッチで確定し、競合するsentを上書きしない。
      const results = await executeStatements(db, [update, select], scope);
      const row = parseRows(reminderSchema, results[1]?.results ?? [])[0];
      if (!row) return { status: "missing" };
      const target = { content: row.content, remindAt: row.remind_at };
      if (results[0]?.meta.changes === 1)
        return { status: "canceled", ...target };
      if (row.status === "canceled")
        return { status: "alreadyCanceled", ...target };
      if (row.status === "sent") return { status: "alreadySent", ...target };
      return { status: "missing" };
    },
    async claimDue(now: Date, group: string) {
      const timestamp = utcTimestamp(now);
      const candidates = await db
        .prepare(
          "SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ? AND group_id = ? ORDER BY remind_at, id",
        )
        .bind(timestamp, group)
        .all();
      const rows = parseRows(reminderSchema, candidates.results);
      if (!rows.length) return [];
      const results = await db.batch(
        rows.map((row) => prepareReminderClaim(db, row.id, timestamp, group)),
      );
      return parseRows(
        claimedSchema,
        results.flatMap((result) => result.results),
      );
    },
    async ownsClaim(claimed: ClaimedReminder) {
      const result = await db
        .prepare(
          "SELECT * FROM reminders WHERE id = ? AND group_id = ? AND status = 'sending' AND claim_token = ?",
        )
        .bind(claimed.id, claimed.group_id, claimed.claim_token)
        .all();
      return parseRows(claimedSchema, result.results).length === 1;
    },
    async expireClaim(claimed: ClaimedReminder, now: Date) {
      const result = await db
        .prepare(
          "UPDATE reminders SET status = 'failed', updated_at = ?, claim_token = NULL WHERE id = ? AND group_id = ? AND status = 'sending' AND claim_token = ?",
        )
        .bind(
          utcTimestamp(now),
          claimed.id,
          claimed.group_id,
          claimed.claim_token,
        )
        .run();
      return result.meta.changes === 1;
    },
    async recoverStale(now: Date, group: string) {
      const timestamp = utcTimestamp(now);
      const cutoff = utcTimestamp(
        new Date(now.getTime() - REMINDER_STALE_AFTER_MS),
      );
      const result = await db
        .prepare(
          "UPDATE reminders SET status = 'pending', updated_at = ?, claim_token = NULL WHERE status = 'sending' AND updated_at < ? AND group_id = ?",
        )
        .bind(timestamp, cutoff, group)
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
