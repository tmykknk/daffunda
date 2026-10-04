import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

function collectFiles(directory = ".") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function scanFiles(files, pattern) {
  for (const path of files) {
    if (pattern.test(readFileSync(path, "utf8")))
      fail(`禁止表現を検出: ${path}`);
  }
}

function isPrepareCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  return (
    (ts.isPropertyAccessExpression(expression) &&
      expression.name.text === "prepare") ||
    (ts.isElementAccessExpression(expression) &&
      ts.isStringLiteral(expression.argumentExpression) &&
      expression.argumentExpression.text === "prepare")
  );
}

function containsUnsafeSql(node) {
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return true;
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return true;
  return ts.forEachChild(node, containsUnsafeSql) === true;
}

function checkSql() {
  if (!existsSync("src")) return;
  for (const path of collectFiles("src").filter((file) =>
    /\.[cm]?[jt]sx?$/.test(file),
  )) {
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      if (isPrepareCall(node)) {
        const outsideRepo = relative("src/repo", path).startsWith("..");
        if (outsideRepo || node.arguments.some(containsUnsafeSql)) {
          const { line } = source.getLineAndCharacterOfPosition(
            node.getStart(source),
          );
          fail(`禁止されたSQLアクセス: ${path}:${line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}

function readToolVersion(config, tool) {
  const tools = config.match(/^\[tools\]([^[]*)/m)?.[1];
  return tools?.match(
    new RegExp(`^\\s*${tool}\\s*=\\s*["']([^"']+)["']`, "m"),
  )?.[1];
}

function checkToolchain() {
  const config = readFileSync("mise.toml", "utf8");
  for (const tool of ["node", "pnpm"]) {
    const requested = readToolVersion(config, tool);
    const result = spawnSync(tool, ["-v"], { encoding: "utf8" });
    const actual = result.stdout?.trim().replace(/^v/, "");
    if (
      !requested ||
      result.status !== 0 ||
      (actual !== requested && !actual.startsWith(`${requested}.`))
    ) {
      fail(
        `ツールチェーン不一致: ${tool} (mise.toml: ${requested ?? "未設定"}, 実環境: ${actual ?? "取得不可"})`,
      );
    }
  }
}

function checkSuppressions() {
  const targets = collectFiles().filter((path) =>
    /^(src\/|test\/|biome\.json$|tsconfig.*\.json$|[^/]*\.config\.[^/]+$|\.jscpd\.json$|knip\.json$|\.dependency-cruiser\.cjs$|wrangler\.toml$)/.test(
      path,
    ),
  );
  scanFiles(
    targets,
    /biome-ignore|@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|(?:istanbul|v8|c8) ignore|\.(?:skip|only|todo)\s*\(/,
  );
}

function generateWranglerConfig() {
  const databaseId = process.env.D1_DATABASE_ID;
  if (!databaseId || !/^[A-Za-z0-9_-]+$/.test(databaseId)) {
    fail("D1_DATABASE_IDを安全な識別子で設定してください");
    return;
  }
  const source = readFileSync("wrangler.toml", "utf8");
  if (!source.includes("<YOUR_D1_DATABASE_ID>")) {
    fail("D1のプレースホルダーが見つかりません");
    return;
  }
  writeFileSync(
    "wrangler.generated.toml",
    source.replaceAll("<YOUR_D1_DATABASE_ID>", databaseId),
  );
}

switch (process.argv[2]) {
  case "ids":
    scanFiles(collectFiles(), /\b[UCR][0-9a-f]{32}\b/);
    break;
  case "sql":
    checkSql();
    break;
  case "toolchain":
    checkToolchain();
    break;
  case "suppressions":
    checkSuppressions();
    break;
  case "config":
    generateWranglerConfig();
    break;
  default:
    fail("検査コマンドを指定してください");
}
