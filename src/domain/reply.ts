export type ReminderListReply = Readonly<{
  type: "reminder_list";
  reminders: readonly Readonly<{ id: number; content: string; time: string }>[];
  nextOffset: number | null;
}>;
export type Reply = string | ReminderListReply;
