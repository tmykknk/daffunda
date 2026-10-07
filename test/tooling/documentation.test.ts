import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test } from "vitest";

test.each(["README.md", "docs/manual-test.md"])(
  "利用者向け文書のローカルリンクが存在する: %s",
  (path) => {
    const document = readFileSync(path, "utf8");
    const links = [...document.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)];
    expect(links.length).toBeGreaterThan(0);
    for (const match of links) {
      const target = match[1];
      if (!target || target.startsWith("#") || /^https?:/u.test(target))
        continue;
      const file = target.split("#")[0];
      if (!file) throw new Error("空のファイルリンク");
      expect(existsSync(resolve(dirname(path), file)), target).toBe(true);
    }
  },
);
