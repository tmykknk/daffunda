import { REMINDER_ACTION_PREFIX } from "../constants";
import { parseListAction } from "./list-action";

type ReminderAction =
  | Readonly<{ type: "cancel"; id: number }>
  | Readonly<{ type: "page"; offset: number }>;

export function parseReminderAction(data: string): ReminderAction | null {
  const action = parseListAction(data, REMINDER_ACTION_PREFIX);
  if (!action) return null;
  if (action.type === "cancel" && action.number > 0)
    return { type: "cancel", id: action.number };
  if (action.type === "page") return { type: "page", offset: action.number };
  return null;
}

export function reminderActionData(action: ReminderAction): string {
  return (
    REMINDER_ACTION_PREFIX +
    (action.type === "cancel" ? `cancel:${action.id}` : `page:${action.offset}`)
  );
}
