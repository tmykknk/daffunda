import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";
import type * as v from "valibot";
import { parseRows, utcTimestamp } from "./rows";

export type EventScope = Readonly<{
  eventId: string;
  operationKey: string;
  now: Date;
  completed: () => void;
}>;
export class DuplicateEvent extends Error {}

export function scopeBindings(scope?: EventScope): readonly (string | null)[] {
  return scope
    ? [scope.eventId, scope.eventId, scope.operationKey]
    : [null, null, null];
}

export async function executeStatements(
  db: D1Database,
  statements: D1PreparedStatement[],
  scope?: EventScope,
) {
  if (!scope) return db.batch(statements);
  const marker = db
    .prepare(
      "INSERT INTO processed_events (event_id, created_at, operation_key) VALUES (?, ?, ?) ON CONFLICT (event_id) DO NOTHING",
    )
    .bind(scope.eventId, utcTimestamp(scope.now), scope.operationKey);
  const [recorded, ...results] = await db.batch([marker, ...statements]);
  if (recorded?.meta.changes !== 1) throw new DuplicateEvent();
  scope.completed();
  return results;
}

export async function executeRows<T extends v.GenericSchema>(
  db: D1Database,
  statement: D1PreparedStatement,
  schema: T,
  scope?: EventScope,
) {
  const results = await executeStatements(db, [statement], scope);
  return parseRows(
    schema,
    results.flatMap((result) => result.results),
  );
}
