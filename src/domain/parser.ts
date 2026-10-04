import {
  COMMANDS,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEMS_PER_MESSAGE,
  RESERVED_WORDS,
} from "../constants";
import { normalizeText } from "./normalize";

type ItemCommand = "add" | "remove";
type UsageCommand = ItemCommand | "reminder" | "remind_delete";
type ParseResult =
  | Readonly<{ type: ItemCommand; items: readonly string[] }>
  | Readonly<{
      type: "list" | "help" | "remind_list" | "limit_error" | "ignore";
    }>
  | Readonly<{ type: "remind_delete"; id: number }>
  | Readonly<{ type: "reminder"; raw: string }>
  | Readonly<{ type: "usage"; command: UsageCommand }>
  | Readonly<{ type: "reserved_word"; words: readonly string[] }>;

function parseItems(raw: string, command: ItemCommand): ParseResult {
  if (!raw) return { type: "usage", command };
  const items = [...new Set(raw.split(/\s+/u))];
  if (
    items.length > MAX_ITEMS_PER_MESSAGE ||
    items.some((item) => [...item].length > MAX_ITEM_NAME_LENGTH)
  )
    return { type: "limit_error" };

  switch (command) {
    case "add": {
      const words = items.filter((item) => RESERVED_WORDS.includes(item));
      return words.length
        ? { type: "reserved_word", words }
        : { type: command, items };
    }
    case "remove":
      return { type: command, items };
    default:
      return command satisfies never;
  }
}

function parseReminderDeletion(text: string): ParseResult {
  const [command, ...argumentsList] = text.split(/\s+/u);
  if (command !== COMMANDS.remindDelete) return { type: "ignore" };
  const argument = argumentsList[0] ?? "";
  const id = Number(argument);
  if (
    argumentsList.length !== 1 ||
    !/^\d+$/u.test(argument) ||
    !Number.isSafeInteger(id) ||
    id <= 0
  )
    return { type: "usage", command: "remind_delete" };
  return { type: "remind_delete", id };
}

function parseNamedCommand(text: string): ParseResult {
  switch (text) {
    case COMMANDS.list:
    case COMMANDS.listHiragana:
      return { type: "list" };
    case COMMANDS.help:
      return { type: "help" };
    case COMMANDS.remindList:
      return { type: "remind_list" };
    default:
      return parseReminderDeletion(text);
  }
}

export function parse(text: string): ParseResult {
  const normalized = normalizeText(text);
  const raw = normalized.slice(1).trim();
  switch (normalized[0]) {
    case "+":
      return parseItems(raw, "add");
    case "-":
      return parseItems(raw, "remove");
    case "/":
      return raw
        ? { type: "reminder", raw }
        : { type: "usage", command: "reminder" };
    default:
      return parseNamedCommand(normalized);
  }
}
