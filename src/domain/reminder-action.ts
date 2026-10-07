import { REMINDER_ACTION_PREFIX } from "../constants";

type ReminderAction =
  | Readonly<{ type: "cancel"; id: number }>
  | Readonly<{ type: "page"; offset: number }>;

export function parseReminderAction(data: string): ReminderAction | null {
  if (!data.startsWith(REMINDER_ACTION_PREFIX)) return null;
  const [type, value, extra] = data
    .slice(REMINDER_ACTION_PREFIX.length)
    .split(":");
  if (extra !== undefined || !value || !/^(0|[1-9]\d*)$/u.test(value))
    return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return null;
  if (type === "cancel" && number > 0) return { type, id: number };
  if (type === "page") return { type, offset: number };
  return null;
}

export function reminderActionData(action: ReminderAction): string {
  return (
    REMINDER_ACTION_PREFIX +
    (action.type === "cancel" ? `cancel:${action.id}` : `page:${action.offset}`)
  );
}
