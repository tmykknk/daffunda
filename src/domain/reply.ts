export type ReminderListReply = Readonly<{
  type: "reminder_list";
  reminders: readonly Readonly<{ id: number; content: string; time: string }>[];
  nextOffset: number | null;
}>;
export type ItemListReply = Readonly<{
  type: "item_list";
  items: readonly Readonly<{ id: number; name: string }>[];
  nextOffset: number | null;
}>;
export type Reply = string | ReminderListReply | ItemListReply;
