import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const root = resolve(".");
const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function cruise(files: Readonly<Record<string, string>>) {
  const workspace = mkdtempSync(join(tmpdir(), "daffunda-architecture-"));
  workspaces.push(workspace);
  for (const [path, content] of Object.entries(files)) {
    const destination = join(workspace, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  writeFileSync(
    join(workspace, "tsconfig.json"),
    readFileSync(join(root, "tsconfig.json")),
  );
  symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"));
  return spawnSync(
    process.execPath,
    [
      join(root, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs"),
      "src",
      "--config",
      join(root, ".dependency-cruiser.cjs"),
    ],
    { cwd: workspace, encoding: "utf8" },
  );
}

test("依存検査はserviceからdomainへの依存を通す", () => {
  const result = cruise({
    "src/domain/value.ts": "export const value = 1;",
    "src/service/example.ts": 'export { value } from "../domain/value";',
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});

test.each(["service", "repo", "line"])(
  "依存検査はdomainから%sへの依存を拒否する",
  (layer) => {
    const result = cruise({
      [`src/${layer}/value.ts`]: "export const value = 1;",
      "src/domain/example.ts": `export { value } from "../${layer}/value";`,
    });
    expect(result.status, result.stdout + result.stderr).toBe(
      layer === "repo" ? 2 : 1,
    );
    expect(result.stdout).toContain("domain-is-pure");
  },
);

test("依存検査はdomainからHonoへの依存を拒否する", () => {
  const result = cruise({
    "src/domain/example.ts": 'export { Hono } from "hono";',
  });
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stdout).toContain("domain-is-pure");
});

test("依存検査はdomainからindexへの依存を拒否する", () => {
  const result = cruise({
    "src/index.ts": "export const value = 1;",
    "src/domain/example.ts": 'export { value } from "../index";',
  });
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stdout).toContain("domain-is-pure");
});

test("依存検査は循環・lineからrepo・本番からtestへの依存を拒否する", () => {
  for (const files of [
    {
      "src/a.ts": 'export { b } from "./b"; export const a = 1;',
      "src/b.ts": 'export { a } from "./a"; export const b = 2;',
    },
    {
      "src/repo/value.ts": "export const value = 1;",
      "src/line/example.ts": 'export { value } from "../repo/value";',
    },
    {
      "test/value.ts": "export const value = 1;",
      "src/example.ts": 'export { value } from "../test/value";',
    },
  ]) {
    const result = cruise(files);
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("error");
  }
});
