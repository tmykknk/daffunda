import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const scripts = resolve("scripts");
const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function createWorkspace(files: Readonly<Record<string, string>>): string {
  const workspace = mkdtempSync(join(tmpdir(), "daffunda-guard-"));
  workspaces.push(workspace);
  for (const [path, content] of Object.entries(files)) {
    const destination = join(workspace, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  return workspace;
}

function runGuard(name: string, workspace: string) {
  return spawnSync("sh", [join(scripts, `${name}.sh`)], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      D1_DATABASE_ID: "test-database",
      MISE_TRUSTED_CONFIG_PATHS: workspace,
    },
  });
}

test("IDガードはダミーIDを通し、ID形式の混入を拒否する", () => {
  const workspace = createWorkspace({
    "src/example.ts": 'const id = "U_test_user_1";',
  });
  expect(runGuard("check-no-real-ids", workspace).status).toBe(0);
  writeFileSync(
    join(workspace, "src/example.ts"),
    ["U", "a".repeat(32)].join(""),
  );
  expect(runGuard("check-no-real-ids", workspace).status).toBe(1);
});

test("IDガードはdocsも検査し、依存とGitメタデータは対象外にする", () => {
  const id = ["C", "b".repeat(32)].join("");
  const workspace = createWorkspace({
    "node_modules/pkg/index.js": id,
    ".git/example": id,
  });
  expect(runGuard("check-no-real-ids", workspace).status).toBe(0);
  writeFileSync(join(workspace, "README.md"), id);
  expect(runGuard("check-no-real-ids", workspace).status).toBe(1);
});

test("SQLガードはrepo内のバインドを通し、repo外のprepareを拒否する", () => {
  const query = 'db.prepare("SELECT ?").bind(value);';
  const workspace = createWorkspace({ "src/repo/example.ts": query });
  expect(runGuard("check-sql", workspace).status).toBe(0);
  writeFileSync(join(workspace, "src/index.ts"), query);
  expect(runGuard("check-sql", workspace).status).toBe(1);
});

test.each([
  "db.prepare(`SELECT ?`);",
  ["db.prepare(`SELECT $", "{value}`);"].join(""),
  'db.prepare(\n "SELECT " +\n value\n);',
  'db.prepare(("SELECT " + value));',
])("SQLガードはテンプレートと複数行の連結を拒否する: %s", (query) => {
  const workspace = createWorkspace({ "src/repo/example.ts": query });
  expect(runGuard("check-sql", workspace).status).toBe(1);
});

test("SQLガードはコメントと文字列中のprepareを誤検出しない", () => {
  const workspace = createWorkspace({
    "src/index.ts": '// db.prepare("SELECT");\nconst label = ".prepare(";',
  });
  expect(runGuard("check-sql", workspace).status).toBe(0);
});

test.each([
  ["src/example.ts", ["@ts", "-ignore"].join("")],
  ["test/example.test.ts", ["test.", "skip("].join("")],
  ["vitest.config.cts", ["test.", "only("].join("")],
  [".dependency-cruiser.cjs", ["v8", " ignore"].join("")],
  ["biome.json", ["biome", "-ignore"].join("")],
])("抑制ガードは対象ファイルの禁止表現を拒否する: %s", (path, content) => {
  const workspace = createWorkspace({ [path]: content });
  expect(runGuard("check-suppressions", workspace).status).toBe(1);
});

test("抑制ガードは正常なコードを通し、docsと検査スクリプトは除外する", () => {
  const marker = ["@ts", "-ignore"].join("");
  const workspace = createWorkspace({
    "src/example.ts": "export const value = 1;",
    "docs/example.md": marker,
    "scripts/example.sh": marker,
  });
  expect(runGuard("check-suppressions", workspace).status).toBe(0);
});

test("ツールチェーンガードはmise.tomlとの一致を検証する", () => {
  const node = spawnSync("node", ["-v"], { encoding: "utf8" })
    .stdout.trim()
    .slice(1);
  const pnpm = spawnSync("pnpm", ["-v"], { encoding: "utf8" }).stdout.trim();
  const workspace = createWorkspace({
    "mise.toml": `[tools]\nnode = "${node}"\npnpm = "${pnpm}"\n`,
    "bin/node": `#!/bin/sh\nif [ "$1" = "-v" ]; then echo 'v${node}'; else exec '${process.execPath}' "$@"; fi\n`,
    "bin/pnpm": `#!/bin/sh\necho '${pnpm}'\n`,
  });
  for (const tool of ["node", "pnpm"])
    chmodSync(join(workspace, "bin", tool), 0o755);
  const check = () =>
    spawnSync("sh", [join(scripts, "check-toolchain.sh")], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(workspace, "bin")}:${process.env.PATH}`,
      },
    });
  expect(check().status).toBe(0);
  writeFileSync(
    join(workspace, "mise.toml"),
    '[tools]\nnode = "999"\npnpm = "999"\n',
  );
  const mismatch = check();
  expect(mismatch.status).toBe(1);
  expect(mismatch.stderr).toContain("ツールチェーン不一致: node");
  expect(mismatch.stderr).toContain("ツールチェーン不一致: pnpm");
});

test("設定生成はDB IDだけを置換し、元の設定を保持する", () => {
  const input = 'name = "test-worker"\ndatabase_id = "<YOUR_D1_DATABASE_ID>"\n';
  const workspace = createWorkspace({ "wrangler.toml": input });
  expect(runGuard("gen-wrangler-config", workspace).status).toBe(0);
  expect(readFileSync(join(workspace, "wrangler.generated.toml"), "utf8")).toBe(
    'name = "test-worker"\ndatabase_id = "test-database"\n',
  );
  expect(readFileSync(join(workspace, "wrangler.toml"), "utf8")).toBe(input);
});

test("設定生成は未設定とTOMLを書き換える入力を拒否する", () => {
  const workspace = createWorkspace({
    "wrangler.toml": 'database_id = "<YOUR_D1_DATABASE_ID>"\n',
  });
  for (const databaseId of ["", 'invalid"\ninjected=true']) {
    const result = spawnSync("sh", [join(scripts, "gen-wrangler-config.sh")], {
      cwd: workspace,
      encoding: "utf8",
      env: { ...process.env, D1_DATABASE_ID: databaseId },
    });
    expect(result.status).toBe(1);
  }
});
