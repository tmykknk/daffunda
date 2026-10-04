# レビューチェックリスト

## PR 提出前（エージェントが確認し、結果を PR 本文に書く）
- [ ] pnpm check が全緑
- [ ] 次のファイルを変更した場合は、変更内容と理由を PR 本文に書く
      biome.json, tsconfig*.json, .jscpd.json, knip.json, .dependency-cruiser.cjs, vitest の設定, test/fixtures
      （原則として緩める変更はしない）
- [ ] pnpm-workspace.yaml の allowBuilds を変更した場合、追加した依存と true にした理由を PR 本文と decisions.md に書く
- [ ] mise.toml と package.json の packageManager フィールドを変更していない
- [ ] 抑制コメントが0件、fixtures の pending の件数を PR 本文に書く
- [ ] 実在の ID・トークン・個人情報がない、wrangler.toml の database_id がプレースホルダーのまま

## 人間レビュー（毎回）
- [ ] CI が緑（pnpm check、gitleaks）
- [ ] 設定ファイル・fixtures の差分で、設定や期待値が緩められていない
- [ ] pnpm-workspace.yaml の allowBuilds の差分（true が増えていないか。増えた場合、その依存は本当にビルドが必要か）
- [ ] mise.toml が変更されていない
- [ ] docs/decisions.md の「要確認」と PR の「未解決」を読み、判断が必要なものに返答
- [ ] ループ記録を実験の記録表に転記

## 節目の確認（人間）
- S0: 公式 index.html.md の取得（H1）、mise の PATH（H10）
- M0a: クラウドで pnpm check が動くか（H2）、メンテナンススクリプトの設定
- M0b: Actions が動くか、.github/workflows を push できたか（H3・H4）、check-toolchain の緑（H11）
- M1〜M2: fixtures 件数（P-34件、R-33件）の一致、補完ルールの違和感
- M5: 署名検証の実装を公式の該当節と自分の目で見比べる（最重要）
- M6: Push の再試行キーの採否と理由
- M7b: README が他人にも再現できる内容か
