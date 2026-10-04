import { expect, test } from "vitest";
import worker from "../src/index";

test("Workers上で起動し、疎通確認に応答する", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/health"),
  );

  expect(navigator.userAgent).toBe("Cloudflare-Workers");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("準備完了");
});
