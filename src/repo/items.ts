import type { D1Database } from "@cloudflare/workers-types";
import type * as v from "valibot";
import { normalizeName } from "../domain/normalize";
import {
  type EventScope,
  executeRows,
  executeStatements,
  scopeBindings,
} from "./event-operation";
import { parseRows, utcTimestamp } from "./rows";
import { itemSchema } from "./schemas";

type RemovalResult =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "removed"; name: string }>
  | Readonly<{ status: "alreadyRemoved"; name: string }>;

type ItemRow = v.InferOutput<typeof itemSchema>;

export function createItemsRepo(db: D1Database, scope?: EventScope) {
  return {
    async add(
      group: string,
      names: readonly string[],
      actor: string | null,
      now: Date,
    ): Promise<readonly ItemRow[]> {
      if (names.length === 0) return [];
      const timestamp = utcTimestamp(now);
      const statements = names.map((name) =>
        db
          .prepare(
            "INSERT INTO items (group_id, name, norm_name, added_by, created_at) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM items WHERE group_id = ? AND norm_name = ? AND done_at IS NULL) AND (? IS NULL OR EXISTS (SELECT 1 FROM processed_events WHERE event_id = ? AND operation_key = ?)) RETURNING *",
          )
          .bind(
            group,
            name,
            normalizeName(name),
            actor,
            timestamp,
            group,
            normalizeName(name),
            ...scopeBindings(scope),
          ),
      );
      const results = await executeStatements(db, statements, scope);
      return results.flatMap((result) => parseRows(itemSchema, result.results));
    },
    async list(group: string) {
      const result = await db
        .prepare(
          "SELECT * FROM items WHERE group_id = ? AND done_at IS NULL AND (? IS NULL OR EXISTS (SELECT 1 FROM processed_events WHERE event_id = ? AND operation_key = ?)) ORDER BY created_at, id",
        )
        .bind(group, ...scopeBindings(scope));
      return executeRows(db, result, itemSchema, scope);
    },
    async removeForButton(
      group: string,
      id: number,
      now: Date,
    ): Promise<RemovalResult> {
      const update = db
        .prepare(
          "UPDATE items SET done_at = ? WHERE group_id = ? AND id = ? AND done_at IS NULL AND (? IS NULL OR EXISTS (SELECT 1 FROM processed_events WHERE event_id = ? AND operation_key = ?))",
        )
        .bind(utcTimestamp(now), group, id, ...scopeBindings(scope));
      const select = db
        .prepare(
          "SELECT * FROM items WHERE group_id = ? AND id = ? AND (? IS NULL OR EXISTS (SELECT 1 FROM processed_events WHERE event_id = ? AND operation_key = ?))",
        )
        .bind(group, id, ...scopeBindings(scope));
      // 状態と表示名も削除・イベント記録と同じバッチで確定する。
      const results = await executeStatements(db, [update, select], scope);
      const row = parseRows(itemSchema, results[1]?.results ?? [])[0];
      if (!row) return { status: "missing" };
      return {
        status: results[0]?.meta.changes === 1 ? "removed" : "alreadyRemoved",
        name: row.name,
      };
    },
    async remove(group: string, names: readonly string[], now: Date) {
      if (names.length === 0) return [];
      const timestamp = utcTimestamp(now);
      const statements = names.map((name) =>
        db
          .prepare(
            "UPDATE items SET done_at = ? WHERE id = (SELECT id FROM items WHERE group_id = ? AND norm_name = ? AND done_at IS NULL ORDER BY created_at, id LIMIT 1) AND (? IS NULL OR EXISTS (SELECT 1 FROM processed_events WHERE event_id = ? AND operation_key = ?)) RETURNING *",
          )
          .bind(timestamp, group, normalizeName(name), ...scopeBindings(scope)),
      );
      const results = await executeStatements(db, statements, scope);
      return results.flatMap((result) => parseRows(itemSchema, result.results));
    },
  };
}
