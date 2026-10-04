import type { D1Database } from "@cloudflare/workers-types";
import type * as v from "valibot";
import { normalizeName } from "../domain/normalize";
import { parseRows, utcTimestamp } from "./rows";
import { itemSchema } from "./schemas";

type ItemRow = v.InferOutput<typeof itemSchema>;

export function createItemsRepo(db: D1Database) {
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
            "INSERT INTO items (group_id, name, norm_name, added_by, created_at) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM items WHERE group_id = ? AND norm_name = ? AND done_at IS NULL) RETURNING *",
          )
          .bind(
            group,
            name,
            normalizeName(name),
            actor,
            timestamp,
            group,
            normalizeName(name),
          ),
      );
      const results = await db.batch(statements);
      return results.flatMap((result) => parseRows(itemSchema, result.results));
    },
    async list(group: string) {
      const result = await db
        .prepare(
          "SELECT * FROM items WHERE group_id = ? AND done_at IS NULL ORDER BY created_at, id",
        )
        .bind(group)
        .all();
      return parseRows(itemSchema, result.results);
    },
    async remove(group: string, names: readonly string[], now: Date) {
      if (names.length === 0) return [];
      const timestamp = utcTimestamp(now);
      const statements = names.map((name) =>
        db
          .prepare(
            "UPDATE items SET done_at = ? WHERE id = (SELECT id FROM items WHERE group_id = ? AND norm_name = ? AND done_at IS NULL ORDER BY created_at, id LIMIT 1) RETURNING *",
          )
          .bind(timestamp, group, normalizeName(name)),
      );
      const results = await db.batch(statements);
      return results.flatMap((result) => parseRows(itemSchema, result.results));
    },
  };
}
