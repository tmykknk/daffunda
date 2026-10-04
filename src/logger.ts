type ErrorCode = "INTERNAL_ERROR";

export function logError(code: ErrorCode): void {
  console.error(JSON.stringify({ code }));
}
