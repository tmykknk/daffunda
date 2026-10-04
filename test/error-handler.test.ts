import { afterEach, expect, test, vi } from "vitest";
import worker from "../src/index";

afterEach(() => vi.restoreAllMocks());

test("予期しない例外は500に変換し、ログには本文や例外内容を残さない", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  worker.get("/__test/error", () => {
    throw new Error("テスト用のメッセージ本文");
  });

  const response = await worker.fetch(
    new Request("https://example.test/__test/error"),
  );

  expect(response.status).toBe(500);
  expect(await response.text()).toBe("処理に失敗しました");
  expect(log).toHaveBeenCalledExactlyOnceWith('{"code":"INTERNAL_ERROR"}');
});
