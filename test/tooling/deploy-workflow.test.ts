import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

const workflowPath = ".github/workflows/check.yml";
function deploymentJob() {
  const workflow = readFileSync(workflowPath, "utf8");
  const job = workflow.split("\n  deploy:\n")[1];
  if (!job) throw new Error("デプロイジョブなし");
  return job;
}

test("デプロイはmainのpushだけ、両TZ検査と秘密検査後のEnvironment承認で実行する", () => {
  const job = deploymentJob();
  expect(job).toContain("needs: [check, secrets]");
  expect(job).toContain(
    "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
  );
  expect(job).toContain("vars.ENABLE_PRODUCTION_DEPLOY == 'true'");
  expect(job).toContain("environment: production");
  expect(job).toContain("if: always()");
  expect(job).toContain("cancel-in-progress: false");
  expect(job).toContain("ref: ${{ github.sha }}");
  expect(job).toContain("permissions:\n      contents: read");
  const workflow = readFileSync(workflowPath, "utf8");
  expect(workflow).toContain("timezone: [UTC, Asia/Tokyo]");
  expect(workflow).not.toContain("workflow_dispatch");
  expect(workflow).not.toContain("pull_request_target");
  for (const action of job.matchAll(/uses: ([^\s]+)/gu))
    expect(action[1]).toMatch(/@[0-9a-f]{40}$/u);
  expect(job).not.toContain("wrangler secret");
  expect(job).not.toContain("upload-artifact");
});

function deploymentScript() {
  const matched = deploymentJob().match(/ {8}run: \|\n((?: {10}[^\n]*\n)+)/u);
  if (!matched?.[1]) throw new Error("デプロイスクリプトなし");
  return matched[1].replace(/^ {10}/gmu, "");
}

// リモートコマンドを実行せず、PATHのスタブで順序と失敗時停止を検証する。
test.each([
  "success",
  "stale",
  "missing",
  "migration-failure",
  "deploy-failure",
])(
  "デプロイは対象SHAと設定を検証し、マイグレーション失敗なら公開しない: %s",
  (scenario) => {
    const workspace = mkdtempSync(join(tmpdir(), "daffunda-deploy-"));
    try {
      const root = process.cwd();
      writeFileSync(
        join(workspace, "wrangler.toml"),
        readFileSync("wrangler.toml"),
      );
      execFileSync("ln", [
        "-s",
        resolve(root, "scripts"),
        join(workspace, "scripts"),
      ]);
      const commands = join(workspace, "commands.log");
      writeFileSync(
        join(workspace, "git"),
        '#!/bin/sh\nif [ "$1" = rev-parse ]; then printf "%s\\n" "$MAIN_SHA"; fi\n',
        { mode: 0o755 },
      );
      writeFileSync(
        join(workspace, "pnpm"),
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COMMAND_LOG"\ncase "$*" in *migrations*) [ "$SCENARIO" != migration-failure ] ;; *deploy*) [ "$SCENARIO" != deploy-failure ] ;; esac\n',
        { mode: 0o755 },
      );
      const result = spawnSync(
        "bash",
        ["-eu", "-o", "pipefail", "-c", deploymentScript()],
        {
          cwd: workspace,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${workspace}:${process.env.PATH}`,
            GITHUB_SHA: "test-current-sha",
            MAIN_SHA:
              scenario === "stale" ? "test-new-sha" : "test-current-sha",
            CLOUDFLARE_API_TOKEN:
              scenario === "missing" ? "" : "test-api-token",
            CLOUDFLARE_ACCOUNT_ID: "test-account",
            D1_DATABASE_ID: "test-database",
            COMMAND_LOG: commands,
            SCENARIO: scenario,
            RUNNER_TEMP: workspace,
          },
        },
      );
      expect(result.status).toBe(scenario === "success" ? 0 : 1);
      const output = result.stdout + result.stderr;
      for (const secret of ["test-api-token", "test-account", "test-database"])
        expect(output).not.toContain(secret);
      if (scenario === "stale" || scenario === "missing")
        expect(() => readFileSync(commands)).toThrow();
      else {
        const calls = readFileSync(commands, "utf8").trim().split("\n");
        expect(calls[0]).toBe(
          "exec wrangler d1 migrations apply DB --remote --config wrangler.generated.toml",
        );
        expect(calls).toHaveLength(scenario === "migration-failure" ? 1 : 2);
        if (calls.length === 2)
          expect(calls[1]).toBe(
            "exec wrangler deploy --config wrangler.generated.toml",
          );
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);
