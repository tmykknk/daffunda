# AGENTS.md

## 目的
LINE買い物リスト＆リマインダーBot。正の優先順位:
1. LINE Messaging API の仕様 → 公式リファレンス（下記）
2. ふるまい → docs/spec.md、docs/parser-cases.md、docs/reminder-cases.md
3. 規約・ツール設定 → docs/conventions.md、docs/tooling.md

## LINE API の参照（必須）
- 公式（Markdown版）を直接読む: https://developers.line.biz/ja/reference/messaging-api/index.html.md
  （通常ページ: https://developers.line.biz/ja/reference/messaging-api/ ）
- LINE API に関わるコード（署名検証、Webhookイベント、Reply/Push、メッセージオブジェクト）を書く前に、
  該当節を公式で確認する。.agents/skills/line-api-check/SKILL.md の手順に従う
- 取得できない場合: 2回まで再試行し、それでも不可なら docs/decisions.md の「要確認」に
  「取得不可（URLとエラー）」を記録する。記憶から仕様を断定して実装せず、安全側に実装して
  PR本文の「未解決」に列挙する
- 確認した節名は、該当コードまたはテストのコメントに残す

## 合格条件
`pnpm check` が通ること。これ以外に「完了」の基準はない。
内容は docs/tooling.md を参照（型・Biome・knip・dependency-cruiser・jscpd・ガード・テスト）。
- リント設定・tsconfig・しきい値を緩めて通すことを禁止する
- 抑制コメントは一切使わない（biome-ignore / @ts-ignore / @ts-expect-error / @ts-nocheck / eslint-disable /
  istanbul・v8・c8 ignore / テストの skip・only）。詰まったら抑制せず、docs/decisions.md の「要確認」に
  書いて PR 本文で人間に判断を仰ぐ。scripts/check-suppressions.sh が検出して失敗させる

## 技術
TypeScript strict / Hono / Cloudflare Workers + D1 / chrono-node(ja) / valibot /
Vitest + @cloudflare/vitest-pool-workers / Biome / pnpm

## ツールチェーン
- Node と pnpm のバージョンは mise.toml が唯一の正。他の場所（package.json の packageManager/engines、
  CI、README、Codex 環境設定）に同じバージョンを重複して書かない
- `corepack enable` を使わない。package.json に `packageManager` フィールドを追加しない
- ツールチェーンの変更（mise.toml の編集）は人間が行う。必要を感じたら docs/decisions.md に理由を書いて PR 本文で提案する
- 実行は PATH 上の `pnpm`（mise の shim）で行う

## 構成と依存方向
src/domain   純粋関数。I/Oなし。時刻は now を引数で受け取る
src/service  ユースケース（domain ← service）
src/repo     D1アクセスはここだけ
src/line     署名検証、Reply/Push クライアント（fetch は注入可能）
src/index.ts ルーティングと scheduled ハンドラの配線のみ
src/constants.ts, src/messages.ts, src/logger.ts

## テスト方針
- docs/*-cases.md の表の全行を test/fixtures/*.json に1対1で転記し、データ駆動テストにする
- fixtures と md の表が食い違わないことを検証する整合性テストを置く
- 期待値を変更してテストを通すことを禁止する。実装を期待値に合わせる
- chrono-node の素の挙動と期待値が違う場合は、domain 層で前処理・後処理を足して合わせる
- 実現できない行だけ fixtures に "pending": "理由" を付けてよい（途中経過のみ）。PR本文の「未解決」に必ず列挙する。
  M7b 完了時点で pending は0件にする
- TZ=UTC と TZ=Asia/Tokyo の両方で通ること

## 禁止事項
- `wrangler deploy` / `wrangler secret` / `--remote` 付きの wrangler d1 コマンドを実行しない
- 実在の ID・トークン・個人情報（LINEの userId/groupId/チャネルID・トークン・シークレット、
  Cloudflare の account_id/database_id、実名、住所、実在の家庭の品目など）を
  コード・テスト・ドキュメント・コミットメッセージに書かない。
  テストのIDは `U_test_user_1` `C_test_group_1` のようなダミーを使う
- .dev.vars, .env*, wrangler.generated.toml をコミットしない
- SQL文字列の連結・テンプレートリテラル禁止。必ず .bind() を使う
- ログにメッセージ本文を出さない
- docs/spec.md と食い違う実装をしない。曖昧なら最も安全な解釈で進め、docs/decisions.md に理由を残す
- wrangler.toml の database_id は `<YOUR_D1_DATABASE_ID>` のプレースホルダーのままにする
- 環境構築（依存関係の追加・ツール設定の変更）は、docs/tasks.md の M0a・M0b でのみ行う。
  それ以外で必要になったら docs/decisions.md に理由を書き、PR本文で明示する

## 進め方
1. docs/tasks.md の未チェック項目を上から1つずつ
2. 失敗するテストを先に書く → 実装 → pnpm check → チェックを付ける → コミット
3. 想定外のバグは再現テストを先に追加する
4. 規則の追加が必要になったら、この AGENTS.md に追記する
5. PR本文に「ループ記録」を書く: pnpm check が失敗した回数、失敗の種類（型/リント/重複/構造/テスト/ガード）、
   それぞれどう直したか、設定を緩めたくなった箇所とその代わりに取った対処
6. PR を出す前に docs/review-checklist.md の「PR 提出前」をすべて確認し、結果を PR 本文に書く
