import { MILLISECONDS_PER_DAY } from "../constants";
import { type createPushClient, PushFailure } from "../line/push";
import { configured } from "../line/webhook-schema";
import { logPushFailure, logRetryExpired } from "../logger";
import { createRemindersRepo } from "../repo/reminders";
import { reminderPushText } from "./replies";
import type { WebhookBindings } from "./webhook";

export type ScheduledOptions = Readonly<{
  push: ReturnType<typeof createPushClient>;
  now: () => Date;
}>;
type Repo = ReturnType<typeof createRemindersRepo>;
type Claimed = Awaited<ReturnType<Repo["claimDue"]>>[number];

async function processClaim(
  claimed: Claimed,
  repo: Repo,
  token: string,
  options: ScheduledOptions,
) {
  if (!(await repo.ownsClaim(claimed))) return;
  const now = options.now();
  // 公式「APIリクエストを再試行する」: 初回claimから保守的に24時間未満だけ再送する。
  if (
    now.getTime() - Date.parse(claimed.retry_started_at) >=
    MILLISECONDS_PER_DAY
  ) {
    if (await repo.expireClaim(claimed, now)) logRetryExpired();
    return;
  }
  await deliverClaim(claimed, repo, token, options);
}

async function deliverClaim(
  claimed: Claimed,
  repo: Repo,
  token: string,
  options: ScheduledOptions,
) {
  const text = reminderPushText(claimed.content);
  try {
    await options.push(token, claimed.group_id, text, claimed.retry_key);
  } catch (error) {
    if (await repo.markFailed(claimed, options.now()))
      logPushFailure(error instanceof PushFailure ? error.status : undefined);
    return;
  }
  // DB完了の失敗をPush失敗と混同せず、sendingの復旧と同じキーの409で回復する。
  await repo.markSent(claimed, options.now());
}

export async function sendDueReminders(
  bindings: WebhookBindings,
  options: ScheduledOptions,
): Promise<void> {
  const token = bindings.LINE_CHANNEL_ACCESS_TOKEN;
  const group = bindings.ALLOWED_GROUP_ID;
  if (!configured(token) || !configured(group) || !group.startsWith("C"))
    return;
  const repo = createRemindersRepo(bindings.DB);
  const now = options.now();
  await repo.recoverStale(now, group);
  const claimed = await repo.claimDue(now, group);
  for (const reminder of claimed)
    await processClaim(reminder, repo, token, options);
}
