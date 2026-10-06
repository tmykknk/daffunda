import { HTTP_STATUS } from "./constants";

type ErrorCode = "INTERNAL_ERROR";

export function logError(code: ErrorCode): void {
  console.error(JSON.stringify({ code }));
}

export function logPushFailure(status?: number): void {
  const code =
    status === HTTP_STATUS.tooManyRequests
      ? "LINE_PUSH_RATE_LIMIT"
      : "LINE_PUSH_FAILED";
  console.error(JSON.stringify({ code, status }));
}

export function logRetryExpired(): void {
  console.error(JSON.stringify({ code: "LINE_PUSH_RETRY_EXPIRED" }));
}

export function logRejected(
  source: Readonly<{
    type: string;
    groupId?: string | undefined;
    roomId?: string | undefined;
    userId?: string | undefined;
  }>,
): void {
  console.info(
    JSON.stringify({
      type: source.type,
      groupId: source.groupId,
      roomId: source.roomId,
      userId: source.userId,
    }),
  );
}
