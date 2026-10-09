import type { parseItemAction } from "../domain/item-action";
import type { Reply } from "../domain/reply";
import { REPLY_TEXT } from "../messages";
import type { createItemsRepo } from "../repo/items";
import { itemPageReply } from "./replies";

export async function handleItemAction(
  action: NonNullable<ReturnType<typeof parseItemAction>>,
  input: Readonly<{ groupId: string; now: Date }>,
  repo: Pick<ReturnType<typeof createItemsRepo>, "list" | "removeForButton">,
): Promise<Reply> {
  if (action.type === "item_page")
    return itemPageReply(await repo.list(input.groupId), action.offset);
  const result = await repo.removeForButton(
    input.groupId,
    action.id,
    input.now,
  );
  switch (result.status) {
    case "removed":
      return REPLY_TEXT.removed([result.name]);
    case "alreadyRemoved":
      return REPLY_TEXT.alreadyRemoved(result.name);
    case "missing":
      return REPLY_TEXT.missingItem;
    default:
      return result satisfies never;
  }
}
