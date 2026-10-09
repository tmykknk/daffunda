export function parseListAction(data: string, prefix: string) {
  if (!data.startsWith(prefix)) return null;
  const [type, value, extra] = data.slice(prefix.length).split(":");
  if (extra !== undefined || !value || !/^(0|[1-9]\d*)$/u.test(value))
    return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? { type, number } : null;
}
