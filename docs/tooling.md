# ツール設定の仕様（M0a・M0b で実装する）

※ ルール名・スキーマ・オプション名は、インストールしたバージョンに合わせて読み替える。
  存在しないルールは同等のルールに置き換え、無効化・緩和する場合は理由を docs/decisions.md に書く。

## package.json の scripts
- typecheck: tsc --noEmit
- lint: biome check
- dead: knip
- arch: depcruise src --config .dependency-cruiser.cjs
- dry: jscpd
- guard: sh scripts/check-no-real-ids.sh && sh scripts/check-sql.sh && sh scripts/check-toolchain.sh && sh scripts/check-suppressions.sh
- test: vitest run --coverage
- check: pnpm typecheck && pnpm lint && pnpm dead && pnpm arch && pnpm dry && pnpm guard && pnpm test
- M0a の時点では check = typecheck && lint && test。M0b で全体に拡張する

## pnpm（12系）
- ビルドスクリプトの許可は pnpm-workspace.yaml の `allowBuilds` で管理する。旧設定
  （onlyBuiltDependencies / neverBuiltDependencies / ignoredBuiltDependencies など）は pnpm 11 で廃止されたため使わない
- `strictDepBuilds` を false にしない。未判断のビルドで install が失敗したら、
  `pnpm approve-builds` または pnpm-workspace.yaml の編集で、必要最小限のものだけ true、不要なものは false を明示する
- 何を許可したかと理由（なぜビルドが必要か）を docs/decisions.md に必ず残す。決め打ちで事前に許可しない
- package.json に packageManager フィールドを追加しない（バージョンは mise.toml が唯一の正）

## tsconfig（追加する項目）
strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noFallthroughCasesInSwitch,
noUnusedLocals, noUnusedParameters, verbatimModuleSyntax, isolatedModules

## Biome（方針）
```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noExcessiveCognitiveComplexity": { "level": "error", "options": { "maxAllowedComplexity": 12 } },
        "noForEach": "error"
      },
      "correctness": { "noUnusedVariables": "error", "noUnusedImports": "error" },
      "style": {
        "noNonNullAssertion": "error", "noParameterAssign": "error", "useConst": "error",
        "useImportType": "error", "noDefaultExport": "error"
      },
      "suspicious": {
        "noExplicitAny": "error", "noConsole": "error",
        "noTsIgnore": "error", "noFocusedTests": "error", "noSkippedTests": "error"
      }
    }
  }
}
```
- override: src/index.ts は noDefaultExport を off（Workers の仕様）
- override: src/logger.ts は noConsole を off（ログ出力はここに集約）
- override: テストファイルは認知的複雑度を off
- 抑制コメントの全面禁止は scripts/check-suppressions.sh でも検出する（二重の防御）

## jscpd（.jscpd.json）
path: ["src"], ignore: ["**/*.test.ts"], minTokens: 60, minLines: 6, threshold: 3, exitCode: 1, reporters: ["console"]

## dependency-cruiser（規則）
- 循環禁止
- src/domain は service・repo・line・index・hono を import しない
- src/domain と src/line は src/repo を import しない
- 本番コードから test/ を import しない

## knip
entry を src/index.ts に設定し、未使用のエクスポート・ファイル・依存関係を検出

## ガードスクリプト
- scripts/check-no-real-ids.sh: リポジトリ全体（node_modules・.git を除く）で正規表現 `\b[UCR][0-9a-f]{32}\b` を検出したら失敗
- scripts/check-sql.sh: src/repo の外で `.prepare(` を使ったら失敗。`.prepare(` にテンプレートリテラルや `+` 連結が渡されていたら失敗
- scripts/check-toolchain.sh: `node -v` と `pnpm -v` を mise.toml の値と比較し、不一致なら失敗（ドリフト検出）
- scripts/check-suppressions.sh: src/・test/・設定ファイル（biome.json、tsconfig*.json、*.config.*、.jscpd.json、
  knip.json、.dependency-cruiser.cjs、wrangler.toml）で次を検出したら失敗
  biome-ignore, @ts-ignore, @ts-expect-error, @ts-nocheck, eslint-disable,
  istanbul ignore, v8 ignore, c8 ignore, .skip(, .only(, .todo(
  （scripts/ と docs/ は対象外。スクリプト自身が検出パターンを含むため）
- scripts/gen-wrangler-config.sh: 環境変数 D1_DATABASE_ID で wrangler.toml のプレースホルダーを置換し wrangler.generated.toml を生成

## カバレッジ（vitest）
- provider は istanbul（Workers プールの制約。動かなければ設定を調整して decisions.md に記録）
- 下限: src/domain/** 95%、src/service/** 90%、全体 85%

## GitHub Actions
- ジョブ1 check: jdx/mise-action で mise.toml からツール導入 → pnpm install --frozen-lockfile → pnpm check
- ジョブ2 secrets: gitleaks を全履歴（fetch-depth: 0）に対して実行
- 外部 Action はコミットSHAで固定。pull_request_target は使わない。権限は最小（contents: read）
- setup-node / pnpm/action-setup / corepack は使わない
- デプロイ用ジョブとシークレットは置かない（今回は CD を作らない）
