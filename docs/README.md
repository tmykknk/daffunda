# What

LINEのTODO＆リマインダーBotです。

> このファイルは**人間向け**の手順書です。エージェント（Codex）は読む必要がありません。
> 仕様・規約・タスクの本体は他の `docs/` にあり、ここでは重複して書かず参照します。

# Why

妻とのTODO共有をLINEで管理したかったからです。
こういう類のサービスはすでに存在しますが
- 自前で実装してみたかった
- AI駆動開発スキル向上
を目的に「作ってみた」ノリやつ。

# How

貧乏性な私は、現時点でAIサブスクの課金対象はOpenAIのみです。流れは以下。
1. Geminiと壁打ち（技術選定）
2. Claude Sonnet 5.5で仕様策定（以下のファイルツリーを生成）
3. Codexで実装（初回の環境構築はローカル、その後はクラウドで実装できるかの実験）

```text
/
├─ mise.toml                  人間が置く。Node と pnpm のバージョンの唯一の正
├─ AGENTS.md                  エージェントが毎回読む短いルール
├─ .agents/skills/
│   ├─ line-api-check/        LINE API を触る前の確認手順
│   └─ add-bot-command/       コマンド追加の定型手順
└─ docs/
   ├─ README.md               この手順書（人間向け）
   ├─ spec.md                 ふるまいの仕様
   ├─ parser-cases.md         パーサーのテストケース（P-系、34件）
   ├─ reminder-cases.md       リマインダーの補完ルールとテストケース（R-系、33件）
   ├─ conventions.md          コーディング規約（機械で検査できないもの）
   ├─ tooling.md              ツール設定の仕様（M0a・M0b で実装）
   ├─ review-checklist.md     PR 提出前・人間レビューのチェック
   ├─ tasks.md                タスク一覧（Codex が上から消化）
   ├─ decisions.md            設計判断と「要確認」
   └─ publish-checklist.md    公開前チェック（人間）
```

Codex が作るもの: `package.json`、`src/`、`test/fixtures/`、`scripts/`、各種設定、CI、利用者向け `README.md`、`LICENSE`、`docs/manual-test.md`

## 1. 事前準備（人間）

### 1-1. リポジトリ
1. GitHub に **private** リポジトリを作る
2. `mise.toml` を置く（`mise use --pin node pnpm` でローカルの版を固定。`corepack enable` と `packageManager` は使わない）
3. 上の構成のファイル（`AGENTS.md`、`.agents/skills/`、`docs/`）を push する
4. `docs/reminder-cases.md` の補完ルール（朝 08:00、1〜5時=午後、日時が複数ならエラーなど）を確認する。変えたい場合は**先にここを直す**

### 1-2. Codex 環境の設定

| 項目 | 値 |
|---|---|
| リポジトリ | 対象の private リポジトリ |
| パッケージバージョン設定（Node など） | **使わない**（mise に一本化） |
| Agent internet access | On |
| Domain allowlist | Common dependencies ＋ `developers.line.biz` |
| Allowed HTTP methods | GET, HEAD, OPTIONS |
| 環境変数・シークレット | **何も入れない**（公開予定のため、エージェントに渡す秘密はゼロ） |

> GitHub 連携だけではエージェント実行中にインターネットへ出られない。セットアップスクリプトは常にインターネット接続あり、エージェント実行中は既定で遮断で、環境ごとに許可を設定する。

### 1-3. セットアップスクリプト

```sh
#!/usr/bin/env bash
set -euo pipefail

# mise の導入（セットアップ段階はインターネット接続あり）
if ! command -v mise >/dev/null 2>&1; then
  curl -fsSL https://mise.run | sh
fi
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
# セットアップ時の環境変数はエージェント実行時に引き継がれない可能性があるため、.bashrc にも書く
echo 'export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"' >> ~/.bashrc

if [ -f mise.toml ]; then
  export MISE_YES=1
  mise trust
  mise install
fi

if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile
fi
```

### 1-4. メンテナンススクリプト（M0a のマージ後に設定）
キャッシュ済みコンテナが古いコミットで作られた場合に依存関係を更新する。

```sh
#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
if [ -f mise.toml ]; then export MISE_YES=1; mise trust; mise install; fi
if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; fi
```

> スクリプトの事前確認には、公開されている参考イメージ（`ghcr.io/openai/codex-universal`）をローカルで動かす方法がある。本番と完全に同一ではない。

## 2. 実行手順

| # | 誰が | 内容 |
|---|---|---|
| 1 | 人間 | 「1. 事前準備」を完了 |
| 2 | Codex | **S0**（疎通スモーク）。コミットなし。H1・H10 を判定 |
| 3 | Codex → 人間 | **M0a** → PR → レビュー → マージ → メンテナンススクリプトを設定 |
| 4 | Codex → 人間 | **M0b** → PR → レビュー → マージ（Actions の動作を確認） |
| 5 | Codex → 人間 | **M1〜M2** → PR → レビュー → マージ |
| 6 | Codex → 人間 | **M3〜M5** → PR → レビュー（M5 の署名検証は公式と見比べる）→ マージ |
| 7 | Codex → 人間 | **M6** → PR → レビュー（再試行キーの採否）→ マージ |
| 8 | Codex → 人間 | **M7a〜M7b**（任意で **R**）→ PR → レビュー → マージ |
| 9 | 人間 | 公開前チェック → public 化 → Branch protection（「6. 公開」） |
| 10 | 人間 | LINE・Cloudflare の設定とデプロイ、実機確認（「7. デプロイと実機確認」） |
| 11 | 人間 | 実験のまとめ（「6. 実験の記録」） |

各タスクの中身と完了条件は `docs/tasks.md` が正。1つの PR をマージしてから次のタスクを投げる。

## 3. Codex に貼るプロンプト

### 3-1. S0（最初に1回）

```text
コードは書かず、何もコミットしないでください。次を実行して結果だけ報告してください。
1. curl -sI https://developers.line.biz/ja/reference/messaging-api/index.html.md の HTTPステータス
   と、同URLの先頭20行の取得可否
2. curl -sI https://registry.npmjs.org/hono の HTTPステータス
3. mise --version、mise current、which node、which pnpm、node -v、pnpm -v
   （mise.toml の値と一致するか。エージェントのシェルの PATH に mise の shim が入っているか）
4. 失敗した場合はエラー全文
```

### 3-2. 共通テンプレート（【　】を差し替え）

```text
このリポジトリの AGENTS.md、docs/spec.md、docs/parser-cases.md、docs/reminder-cases.md、
docs/conventions.md、docs/tooling.md、docs/review-checklist.md、docs/tasks.md、docs/decisions.md を
最初に全部読んでください。
今回の担当は docs/tasks.md の【M0a】です。
- LINE API に関わる実装は、AGENTS.md の「LINE API の参照」に従い、実装前に公式の Markdown 版を確認してください
- 各マイルストーンはテストを先に書き、pnpm check を通してからコミットしてください
- 期待値やリント設定・しきい値を緩めて通すことは禁止です。抑制コメントも使わないでください。コードを直して通してください
- 完了した項目は docs/tasks.md にチェックを付けてください
- AGENTS.md の禁止事項（実在ID・トークン・個人情報の記載禁止を含む）は絶対に守ってください
- PR を出す前に docs/review-checklist.md の「PR 提出前」をすべて確認し、結果を PR 本文に書いてください
- 最後に PR を作り、完了項目・判断した点・pending にした行・要確認・未解決点・ループ記録を要約してください
```

### 3-3. 【担当】の差し替え順

| 回 | 【担当】 | 人間が特に見る点 |
|---|---|---|
| 1 | M0a | `pnpm check` がクラウドで動く（H2）、`allowBuilds` の差分、`mise.toml` が無変更 |
| 2 | M0b | Actions が動く（H3・H4）、`check-toolchain` が緑（H11）、`check-suppressions` が入っている |
| 3 | M1〜M2 | fixtures 件数（P-34、R-33）、補完ルールの違和感、整合性テスト |
| 4 | M3〜M5 | 署名検証を公式の該当節と**自分の目で**見比べる（最重要） |
| 5 | M6 | Push の再試行キーの採否と理由、429 のログ |
| 6 | M7a〜M7b | 整理周回で挙動が変わっていないか、README が他人に再現できるか、pending が 0 件 |
| 7（任意） | R | 逸脱の指摘が妥当か |

## 4. 公開（人間）

1. `docs/publish-checklist.md` を上から実施する（CI の gitleaks 全履歴、実 ID 検査など）
2. 問題なければ **public に変更**する
3. Settings → Branch protection（main への直接 push 禁止）を設定する

## 5. デプロイと実機確認（人間）

自動デプロイ（CD）は今回作らない（`decisions.md` D-12）。

1. LINE Developers でチャネルを作成し、チャネルシークレットとアクセストークンを取得
2. `wrangler d1 create` → マイグレーション適用
3. `wrangler secret put` を3つ（`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`ALLOWED_GROUP_ID`）
4. `D1_DATABASE_ID` を環境変数で渡して `scripts/gen-wrangler-config.sh` を実行し、生成された設定でデプロイ
5. Webhook URL を設定し、Bot をグループに招待。groupId をログから取得して `ALLOWED_GROUP_ID` に設定
6. `docs/manual-test.md` の実機チェック（追加・削除・リスト・雑談無視・リマインダー発火・再送）
7. Push の無料枠の上限を、LINE Official Account Manager で確認する

## 6. 実験の記録

### 6-1. 記録表（PR ごと）

| タスク | 所要時間 | check の失敗回数と種類 | 人間の介入 | 設定を緩めようとしたか | pending 数 | 詰まった箇所 |
|---|---|---|---|---|---|---|

ループ記録（失敗回数・種類・直し方）は Codex が PR 本文に書く。人間が表に転記する。

### 6-2. 仮説

| # | 仮説 | 判定する場所 |
|---|---|---|
| H1 | エージェント側から公式の `index.html.md` を取得できる | S0 |
| H2 | クラウドで `pnpm check` の全工程が動く（workerd、カバレッジ、knip など） | M0a・M0b |
| H3 | `.github/workflows` をエージェントが push できる | M0b |
| H4 | PR 作成と GitHub Actions の CI が連動する | M0a の PR |
| H5 | 1回のタスクで複数マイルストーン（M1〜M2 など）を最後まで完走できる | M1〜M2 |
| H6 | 失敗→修正のループで、設定を緩めずに緑にできる | 全 PR のループ記録 |
| H7 | fixtures と md の整合性テストで、期待値の改ざんを検出できる | M1〜M2 |
| H8 | 整理周回（M7a）と自己レビュー周回（R）で品質が上がる | M7a・R |
| H9 | 公式仕様の確認結果がコードに反映される（節名のコメント、再試行キーの採否） | M5・M6 |
| H10 | セットアップで導入した mise のツールチェーンが、エージェント実行フェーズでも有効 | S0 |
| H11 | `mise.toml` と実環境のバージョンが一致する（`check-toolchain.sh` が緑） | M0b |

### 6-3. まとめ方
H1〜H11 の結果と、「クラウドで完結できたか」の結論（どこまで完結し、どこから人間が必要だったか）を残す。

## 7. つまずきやすい点と対処

| 症状 | 原因の候補 | 対処 |
|---|---|---|
| S0 で公式 URL が取れない | エージェント側のインターネットが遮断／許可ドメインの不足 | 環境設定の Agent internet access を確認。`developers.line.biz` を追加。設定が On でも通信できないという報告があるため、設定を変えて S0 をやり直す |
| S0 で `mise` / `pnpm` が見つからない（H10 失敗） | セットアップ時の PATH がエージェント実行時に引き継がれない | `.bashrc` 以外の方法（スクリプトで `/usr/local/bin` にシンボリックリンクを作る等）に切り替える |
| M0a で `ERR_PNPM_IGNORED_BUILDS` | 未判断のビルドスクリプトを持つ依存がある | `pnpm-workspace.yaml` の `allowBuilds` で true/false を明示し、理由を `decisions.md` に残す（`strictDepBuilds` は無効にしない） |
| M0b で `.github/workflows` を push できない（H3） | エージェントの権限制限の可能性 | Codex に PR 本文へファイル内容を貼らせ、人間がコミットする。実験結果として記録 |
| クラウドで `pnpm check` が赤、ローカルは緑 | ネットワーク、Node／pnpm のバージョン、workerd の取得 | S0 の出力と `check-toolchain` の結果を確認。環境側（セットアップスクリプト）を直す |
| Codex がしきい値や期待値を緩めようとする | ループ中の近道 | PR で却下。`docs/review-checklist.md` の項目で差分を確認。再発したら AGENTS.md に規則を追記 |
| Codex が途中で止まる／時間切れ | 1回のタスクが大きすぎる | タスクを分割して再投入。どこで止まったか（時間・文脈・ツール）を記録 |

## 8. 参考

- LINE Messaging API リファレンス（Markdown 版）: https://developers.line.biz/ja/reference/messaging-api/index.html.md
- Codex cloud: エージェントのインターネットアクセス: https://developers.openai.com/codex/cloud/agent-internet
- Codex cloud: 環境（セットアップスクリプト・キャッシュ）: https://developers.openai.com/codex/cloud/environments
- codex-universal（標準イメージの参考実装）: https://github.com/openai/codex-universal
