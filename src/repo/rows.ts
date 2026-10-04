import * as v from "valibot";

export function parseRows<T extends v.GenericSchema>(
  schema: T,
  rows: unknown,
): readonly v.InferOutput<T>[] {
  const parsed = v.safeParse(v.array(schema), rows);
  if (!parsed.success) throw new Error("D1_ROW_INVALID");
  return parsed.output;
}

export function firstRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (!row) throw new Error("D1_INSERT_EMPTY");
  return row;
}

export function utcTimestamp(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("D1_TIME_INVALID");
  return date.toISOString();
}
