type ErrorCode = "INTERNAL_ERROR";

export function logError(code: ErrorCode): void {
  console.error(JSON.stringify({ code }));
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
