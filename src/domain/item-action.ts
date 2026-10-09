import { ITEM_ACTION_PREFIX } from "../constants";
import { parseListAction } from "./list-action";

type ItemAction =
  | Readonly<{ type: "remove_item"; id: number }>
  | Readonly<{ type: "item_page"; offset: number }>;

export function parseItemAction(data: string): ItemAction | null {
  const action = parseListAction(data, ITEM_ACTION_PREFIX);
  if (!action) return null;
  if (action.type === "remove" && action.number > 0)
    return { type: "remove_item", id: action.number };
  if (action.type === "page")
    return { type: "item_page", offset: action.number };
  return null;
}

export function itemActionData(action: ItemAction): string {
  return (
    ITEM_ACTION_PREFIX +
    (action.type === "remove_item"
      ? `remove:${action.id}`
      : `page:${action.offset}`)
  );
}
