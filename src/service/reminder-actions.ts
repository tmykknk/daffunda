import type { parseReminderAction } from "../domain/reminder-action";
import { REPLY_TEXT } from "../messages";
import type { createRemindersRepo } from "../repo/reminders";
import { type ButtonReply, reminderPageReply } from "./replies";

type Input = Readonly<{ groupId: string; now: Date }>;
export async function handleReminderAction(
  action: NonNullable<ReturnType<typeof parseReminderAction>>,
  input: Input,
  repo: Pick<
    ReturnType<typeof createRemindersRepo>,
    "listUnsent" | "cancelForButton"
  >,
): Promise<ButtonReply> {
  if (action.type === "page")
    return reminderPageReply(
      await repo.listUnsent(input.groupId),
      action.offset,
    );
  const result = await repo.cancelForButton(
    input.groupId,
    action.id,
    input.now,
  );
  const text =
    result === "missing"
      ? REPLY_TEXT.missingReminder(action.id)
      : REPLY_TEXT[result](action.id);
  return { text, actions: [] };
}
