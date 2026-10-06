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
- [ ] .gitignore の対象（mise.local.toml、wrangler.generated.toml、.dev.vars、.wrangler）が追跡されていない
- [ ] docs/decisions.md の「要確認」と PR の「未解決」を読み、判断が必要なものに返答
- [ ] ループ記録を実験の記録表に転記

## 節目の確認（人間）
- S0: 公式 index.html.md の取得（H1）、mise の PATH（H10）
- M0a: クラウドで pnpm check が動くか（H2）、環境の依存関係の更新（docs/README.md 3-4）
- M0b: Actions が動くか、.github/workflows を push できたか（H3・H4）、check-toolchain の緑（H11）、
  カバレッジの閾値をどう通したか（テスト追加／除外／閾値変更。除外と閾値変更は原則不可）
- M1〜M2: fixtures 件数（P-34件、R-33件）の一致、補完ルールの違和感
- M3: migrations/ の SQL を目視（items、reminders、processed_events、索引、retry_key の有無）。リモートへの適用は M5 のマージ後
- M4: 返信文・予約語・上限・かな統一の挙動が spec.md と合っているか
- M5: 署名検証の実装を公式の「Webhookの署名を検証する」と見比べる（下の表）。events が空のリクエストが 200 になるテストがあること。
  マージ後は docs/deploy.md の B0（ローカル確認）→ B（初回デプロイ）
- M6: Push の再試行キーの採否と理由。マージ後にリマインダーの実機確認と Push 無料枠の確認
- M7a: マージ後に再デプロイして、実機で挙動が変わっていないか確認
- M7b: README が他人にも再現できる内容か、pending が0件か

### M5 署名検証のレビュー基準（対象: src/line/verify.ts と src/index.ts）
公式: https://developers.line.biz/ja/docs/messaging-api/verify-webhook-signature/

| # | 見るもの | OK の条件 |
|---|---|---|
| 1 | ボディの読み方 | 検証前に `json()` や `JSON.parse` をしていない。`text()` または `arrayBuffer()` で1回だけ読み、その値を検証に使い、あとで同じ値から JSON をパースしている |
| 2 | アルゴリズムと鍵 | HMAC-SHA256、鍵はチャネルシークレット（UTF-8） |
| 3 | 比較の形式 | Base64（hex や base64url ではない） |
| 4 | ヘッダーの取得 | `x-line-signature`（大文字小文字を区別しない取得） |
| 5 | 欠落・不一致の扱い | どちらも 401。DB と LINE API を一切呼ばない |
| 6 | エンコーディング | UTF-8。`arrayBuffer()` を直接 HMAC に渡すのが最も安全 |
| 7 | 比較方法 | 定数時間比較（`===` ではない） |
| 8 | 処理の順序 | 署名検証 → JSON パース → 許可 groupId の判定 → 冪等性（processed_events）→ 処理。DB の更新は検証より後 |
| 9 | テスト | 正しい署名で200、ボディ改変・空白追加・ヘッダー欠落で401、events が空で200。openssl で独立に計算した固定ペア（ダミー ID）がある |
| 10 | ログ | 本文、署名、シークレットを出していない |
