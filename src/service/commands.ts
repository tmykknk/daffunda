import { normalizeName } from "../domain/normalize";
import { parse } from "../domain/parser";
import { parseReminder } from "../domain/reminder-parse";
import type { Reply } from "../domain/reply";
import { MESSAGES, REPLY_TEXT } from "../messages";
import type { createItemsRepo } from "../repo/items";
import type { createRemindersRepo } from "../repo/reminders";
import {
  boundedList,
  formatTokyoTime,
  registrationReply,
  reminderPageReply,
} from "./replies";

type Repositories = Readonly<{
  items: ReturnType<typeof createItemsRepo>;
  reminders: Pick<
    ReturnType<typeof createRemindersRepo>,
    "create" | "listUnsent" | "cancel"
  >;
}>;
type Request = Readonly<{
  text: string;
  groupId: string;
  userId: string | null;
  now: Date;
}>;
type Command = ReturnType<typeof parse>;

function classifyItems(
  names: readonly string[],
  rows: readonly Readonly<{ norm_name: string }>[],
) {
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(row.norm_name, (counts.get(row.norm_name) ?? 0) + 1);
  const changed: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const key = normalizeName(name);
    const remaining = counts.get(key) ?? 0;
    if (remaining > 0) {
      changed.push(name);
      counts.set(key, remaining - 1);
    } else missing.push(name);
  }
  return { changed, missing };
}

async function modifyItems(
  command: Extract<Command, { type: "add" | "remove" }>,
  input: Request,
  repo: Repositories["items"],
): Promise<string> {
  const rows =
    command.type === "add"
      ? await repo.add(input.groupId, command.items, input.userId, input.now)
      : await repo.remove(input.groupId, command.items, input.now);
  const { changed, missing } = classifyItems(command.items, rows);
  const successText =
    command.type === "add" ? REPLY_TEXT.added : REPLY_TEXT.removed;
  const missingText =
    command.type === "add" ? REPLY_TEXT.registered : REPLY_TEXT.missingItems;
  return [
    changed.length ? successText(changed) : "",
    missing.length ? missingText(missing) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function registerReminder(
  raw: string,
  input: Request,
  repo: Repositories["reminders"],
): Promise<string> {
  const parsed = parseReminder(raw, input.now);
  if (!parsed.ok) return MESSAGES.reminderErrors[parsed.code];
  const row = await repo.create({
    groupId: input.groupId,
    content: parsed.content,
    remindAt: new Date(parsed.remindAt),
    createdBy: input.userId,
    retryKey: null,
    now: input.now,
  });
  return registrationReply(row.id, formatTokyoTime(row.remind_at), row.content);
}

async function listItems(
  groupId: string,
  repo: Repositories["items"],
): Promise<string> {
  const rows = await repo.list(groupId);
  return boundedList(
    rows.map((row) => REPLY_TEXT.item(row.name)),
    MESSAGES.emptyItems,
  );
}

async function listReminders(
  groupId: string,
  repo: Repositories["reminders"],
): Promise<string> {
  const rows = await repo.listUnsent(groupId);
  return boundedList(
    rows.map((row) =>
      REPLY_TEXT.reminder(row.id, formatTokyoTime(row.remind_at), row.content),
    ),
    MESSAGES.emptyReminders,
  );
}

async function cancelReminder(
  id: number,
  input: Request,
  repo: Repositories["reminders"],
): Promise<string> {
  return (await repo.cancel(input.groupId, id, input.now))
    ? REPLY_TEXT.canceled(id)
    : REPLY_TEXT.missingReminder(id);
}

async function executeCommand(
  command: Command,
  input: Request,
  repos: Repositories,
): Promise<string | null> {
  switch (command.type) {
    case "add":
    case "remove":
      return modifyItems(command, input, repos.items);
    case "list":
      return listItems(input.groupId, repos.items);
    case "remind_list":
      return listReminders(input.groupId, repos.reminders);
    case "reminder":
      return registerReminder(command.raw, input, repos.reminders);
    case "remind_delete":
      return cancelReminder(command.id, input, repos.reminders);
    case "help":
      return MESSAGES.help;
    case "usage":
      return MESSAGES.usage[command.command];
    case "reserved_word":
      return REPLY_TEXT.reserved(command.words);
    case "limit_error":
      return MESSAGES.limitError;
    case "ignore":
      return null;
    default:
      return command satisfies never;
  }
}

export function handleText(
  input: Request,
  repos: Repositories,
): Promise<string | null> {
  return executeCommand(parse(input.text), input, repos);
}

export async function handleReply(
  input: Request,
  repos: Repositories,
): Promise<Reply | null> {
  const command = parse(input.text);
  if (command.type === "remind_list")
    return reminderPageReply(
      await repos.reminders.listUnsent(input.groupId),
      0,
    );
  return executeCommand(command, input, repos);
}
