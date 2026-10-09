# What

LINEのTODO＆リマインダーBotです。
「ライン -> アイーン -> だっふんだ」の発想でこのリポジトリ名にしました。

# Why

妻とのTODO共有をLINEで管理したかったからです。
こういう類のサービスはすでに存在しますが
- 自前で実装してみたかった
- AI駆動開発スキル向上
を目的に「作ってみた」ノリやつ＆学習目的。

# How

貧乏性な私は、現時点でAIサブスクの課金対象はOpenAIのみです。今回実施した流れは以下。

1. Geminiと壁打ち（技術選定）
2. Claude Sonnet 5.5で仕様策定（以下のファイルツリーを生成）
3. ローカルにファイルを準備して Git init → リモートリポジトリ作成
4. Codex (クラウド) の環境設定、GitHubと連携
5. PRを確認してマージ、ドキュメントの更新を繰り返す

```text
/
├─ mise.toml                  人間が置く。Node と pnpm のバージョンの唯一の正
├─ AGENTS.md                  エージェントが毎回読む短いルール
├─ .agents/skills/
│   ├─ line-api-check/        LINE API を触る前の確認手順
│   └─ add-bot-command/       コマンド追加の定型手順
└─ docs/
   ├─ spec.md                 ふるまいの仕様
   ├─ parser-cases.md         パーサーのテストケース（P-系、34件）
   ├─ reminder-cases.md       リマインダーの補完ルールとテストケース（R-系、33件）
   ├─ conventions.md          コーディング規約（機械で検査できないもの）
   ├─ tooling.md              ツール設定の仕様（M0a・M0b で実装）
   ├─ review-checklist.md     PR 提出前・人間レビューのチェック
   ├─ tasks.md                タスク一覧（Codex が上から消化）
   ├─ decisions.md            設計判断と「要確認」
   ├─ line-setup.md           LINE の設定手順（人間向け）
   └─ deploy.md               デプロイ手順（人間向け）
```

## 1. Codex (クラウド) の環境設定

ブラウザ (Web版) で以下を設定。

| 項目 | 値 |
|---|---|
| リポジトリ | 対象の private リポジトリ |
| Install script | 以下のスクリプト（編集画面の Scripts 欄で確認） |
| Start skill | 設定しない（今は不要） |
| Allow Codex to access internet | On |
| Allow domains | Package managers |
| Additional allowed domains | `developers.line.biz`（mise の導入などで他のホストの許可が必要になった場合は、エラーを見て追加） |
| Environment variables / Network secrets | **何も入れない**（公開予定のため、エージェントに渡す秘密はゼロ） |
| Privacy（Who can use） | Only me |
| 公開 | Save draft のあと **Publish**。未公開（Unpublished）の環境ではタスクを開始できない |

設定画面: Settings → Codex Cloud → Environments（または、新規タスクの Work in → Cloud → 環境セレクタ → Manage environments）

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

## 2. 実行手順

| # | 誰が | 内容 |
|---|---|---|
| 1 | 人間 | クラウドの環境構築 |
| 2 | 人間 | **並行して** LINE 側の準備（`docs/line-setup.md` の 2〜4 と 9）と `wrangler d1 create`。値は控えるだけ（リポジトリや環境変数に入れない） |
| 3 | Codex | **S0**（疎通スモーク）。H1・H10 を判定（済み） |
| 4 | Codex → 人間 | **M0a** → PR → レビュー → マージ |
| 5 | Codex → 人間 | **M0b** → PR → レビュー → マージ（Actions の動作を確認） |
| 6 | Codex → 人間 | **M1〜M2** → PR → レビュー → マージ |
| 7 | Codex → 人間 | **M3〜M5** → PR → レビュー（M5 の署名検証は公式と見比べる）→ マージ |
| 8 | 人間 | **初回デプロイと実機確認**（`docs/line-setup.md` の 5〜6）。groupId の取得と設定、追加・削除・リスト・雑談無視・再送・ヘルプ。見つかった問題は次のタスクへ |
| 9 | Codex → 人間 | **M6** → PR → レビュー（再試行キーの採否）→ マージ → DBマイグレーション、再デプロイ → リマインダーの実機確認と Push 無料枠の確認 |
| 10 | Codex → 人間 | **M7a〜M7b**（任意で **R**）→ PR → レビュー → マージ → M7a 後に再デプロイして挙動を再確認 |
| 11 | 人間 | 公開前チェック → public 化 → Branch protection（「4. 公開」） |
| 12 | 人間 | 実験のまとめ（「6. 実験の記録」） |

各タスクの中身と完了条件は `docs/tasks.md` が正。1つの PR をマージしてから次のタスクを投げる。

## 3. Codex に送る指示

指示は**タスク名だけ**でよい。読むファイル、進め方、PR 本文の形式は `AGENTS.md` の「タスクの受け方」に書いてある。

| 送る文字列 | 内容 | 人間が特に見る点 |
|---|---|---|
| `S0` | 疎通確認（読み取りのみ） | H1・H10 |
| `M0a` | 足場（最小） | `pnpm check` がクラウドで動く（H2）、`allowBuilds` の差分、`mise.toml` が無変更 |
| `M0b` | 検査の追加 | Actions が動く（H3・H4）、`check-toolchain` が緑（H11）、`check-suppressions` が入っている、カバレッジの閾値をどう通したか |
| `M1〜M2` | パーサーとリマインダー解釈 | fixtures 件数（P-34、R-33）、補完ルールの違和感、整合性テスト |
| `M3〜M5` | repo・service・署名検証・Webhook | 署名検証を公式の該当節と**自分の目で**見比べる（最重要） |
| `M6` | Cron 送信 | Push の再試行キーの採否と理由、429 のログ |
| `M7a〜M7b` | 整理周回・README・仕上げ | 挙動が変わっていないか、README が他人に再現できるか、pending が 0 件 |
| `R`（任意） | 自己レビュー周回 | 逸脱の指摘が妥当か |
| `REVIEW <PR番号>` | PR のチェックリスト確認（読み取りのみ） | 自己点検なので独立した検証ではない。重要項目は人間が見る |
| `次` | 未チェックの先頭の必須項目を1つ | 実行前に何が対象か確認する |

補足:
- 1回の指示で複数のマイルストーンを投げられる（`M1〜M2` など）。分割するときは1つずつ
- 前提のタスクが未完了のときは、Codex が着手せずに報告して止まる
- 追加の注意（例:「公式の〇〇節を特に確認して」）は、タスク名のあとに続けて書いてよい

## 4. デプロイと実機確認

LINE の設定、デプロイ、groupId の取得、実機確認は `docs/line-setup.md` に従う。
時期は「2. 実行手順」の 2・8・9・10 を参照（M5 の後に初回、M6 の後にリマインダー、M7a の後に再確認）。
更新用の承認付きActions（M8）は[デプロイ手順F](docs/deploy.md#f-m8-承認付きgithub-actionsで更新する人間が設定確認)に従って人間が有効化できます。初回導入とSecret操作は手元で行います。

1. LINE Developers でチャネルを作成し、チャネルシークレットとアクセストークンを取得
2. `wrangler d1 create` → マイグレーション適用
3. `wrangler secret put` を3つ（`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`ALLOWED_GROUP_ID`）
4. `D1_DATABASE_ID` を環境変数で渡して `scripts/gen-wrangler-config.sh` を実行し、生成された設定でデプロイ
5. Webhook URL を設定し、Bot をグループに招待。groupId をログから取得して `ALLOWED_GROUP_ID` に設定
6. `docs/manual-test.md` の実機チェック（追加・削除・リスト・雑談無視・リマインダー発火・再送）
7. Push の無料枠の上限を、LINE Official Account Manager で確認する

## 5. 実験の記録

| タスク | 所要時間 | check の失敗回数と種類 | 人間の介入 | 設定を緩めようとしたか | pending 数 | 詰まった箇所 |
|---|---|---|---|---|---|---|
| M0a | 20m 39s | 4回 / 型の問題 | 0 | 0 | 0 | 0 |
| M0b | 18m 57s | 1回 / 依存宣言の修正 | 0 | 0 | 0 | 0 |
| M1 | 10m 20s | 1回 / カバレッジ | 0 | 0 | 0 | 0 |
| M2 | 21m 1s | 1回 / 未使用export | 0 | 0 | 0 | 0 |
| M3 | 22m 18s | 3回 / 型、依存検査、リント | 0 | 0 | 0 | 0 |
| M4 | 10m 23s | 0 | 0 | 0 | 0 | 0 |
| M5 | 20m 8s | 1回 / ログ引数型 | 0 | 0 | 0 | 0 |
| M6 | 11m 14s | 1回 / knipの重複export | 0 | 0 | 0 | 0 |
| M7a | 9m 23s | 1回 / knipの未使用export | 0 | 0 | 0 | 0 |
| R | 9m 23s | 1回 / repoが公開しないoperation_keyを検査していた | 0 | 0 | 0 | 0 |
| R(修正) | 5m 12s | 1回 / 新規テストの型 | 0 | 0 | 0 | 0 |
| I1 | 18m 58s | 1回 / 型の問題 | 0 | 0 | 0 | 0 |
| I2 | 12m 21s | 1回 / READMEリンク切れ | 0 | 0 | 0 | 0 |

ループ記録（失敗回数・種類・直し方）は Codex が PR 本文に書く。人間が表に転記する。

## 6. 参考

- LINE Messaging API リファレンス（Markdown 版）: https://developers.line.biz/ja/reference/messaging-api/index.html.md
- Codex cloud: エージェントのインターネットアクセス: https://developers.openai.com/codex/cloud/agent-internet
- Codex cloud: 環境（セットアップスクリプト・キャッシュ）: https://developers.openai.com/codex/cloud/environments
- codex-universal（標準イメージの参考実装）: https://github.com/openai/codex-universal

---

## 日本語

### できること

| 入力例（ダミー） | 動作 |
|---|---|
| `+テスト品目A テスト品目B` | 品目を追加。空白・改行で区切る |
| `-テスト品目A` | 品目を削除 |
| `リスト` / `りすと` | 買い物一覧 |
| `/テスト 明日15時` | 単発リマインダーを登録し、解釈した日時と番号を返信 |
| `リマインド` | 未送信の予定を5件ずつ、内容・日時・取消ボタンを一つのFlexに表示（失敗・送信処理中も含む） |
| `ヘルプ` | 使い方 |

全角の記号・数字も正規化します。品目は1メッセージ20件、名前は50文字まで。追加した品目の照合ではひらがな・カタカナを統一します。雑談・画像・スタンプは無視します。

日付のみは09:00、午前・午後のない1〜5時は午後として補完します。相対指定は符号なし整数のみで、小数・負数は拒否します。月・日は1〜2桁で、`03/05`は受け付け、`003/5`は拒否します。日時は1つ、現在から1年以内を指定してください。毎週などの繰り返し登録はなく、解釈できた次回の単発になります。詳細は[仕様](docs/spec.md)と[日時の補完ルール](docs/reminder-cases.md)を参照してください。

### 自分の環境で動かす

1. このリポジトリを取得し、ルートへ移動します。[mise](https://mise.jdx.dev/)をインストールし、シェルから`mise`を呼べる状態にします。
2. リポジトリを確認してから次を実行します。Nodeとpnpmのバージョンは[mise.toml](mise.toml)だけで管理します。

   ```sh
   mise trust
   mise install
   mise exec -- pnpm install --frozen-lockfile
   mise exec -- pnpm check
   ```

3. [LINE設定手順](docs/line-setup.md)に従い公式アカウントのMessaging APIを有効にします。応答メッセージ・あいさつメッセージはオフ、グループ参加は許可します。長期アクセストークンとチャネルシークレットは手元で安全に保管します。
4. CloudflareアカウントとD1を用意し、[デプロイ手順](docs/deploy.md)のA→B0→Bに従います。D1 IDは無視対象の`mise.local.toml`に置き、設定を生成します。マイグレーションをコードより先に適用し、手元でデプロイ・Secret登録を行います。リポジトリの`wrangler.toml`はプレースホルダーのままにします。
5. Webhook URLを`<WorkerのURL>/webhook`に設定し、検証・Webhook利用を有効にします。Botを対象グループに招待し、拒否ログから得たgroupIdを`ALLOWED_GROUP_ID`のSecretに登録します。`ヘルプ`の返信を確認します。
6. [実機確認](docs/manual-test.md)を実施します。更新時は[再デプロイ手順](docs/deploy.md)のCに従い、LINE公式アカウントのPush無料枠も確認します。

詳細な画面操作やコマンドはリンク先を正として参照してください。Cloudflare/LINEの実値をREADME・Issue・PR・チャットへ貼らないでください。Secretは`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`ALLOWED_GROUP_ID`の3つです。

### ローカル開発・検査

[デプロイ手順](docs/deploy.md)のB0はダミー値でローカルの署名検証を確認できます。通常の開発は`mise exec -- pnpm dev`でローカルWorkerを起動します。元のD1 IDはプレースホルダーのため、DB設定が必要ならA/B0の生成設定を使ってください。

```sh
TZ=UTC mise exec -- pnpm check
TZ=Asia/Tokyo mise exec -- pnpm check
```

検査には型・リント・未使用・依存方向・重複・ID/SQL/ツールチェーン/抑制ガード・カバレッジが含まれます。テストはローカルD1とLINEクライアントのモックを使います。`.dev.vars`などローカル秘密ファイルがIDガードを止める場合は、値を変更・出力せず、秘密ファイルのない別のcheckoutで検査してください。CIも両タイムゾーンで検査し、全Git履歴をgitleaksで確認します。

### 運用上の制約

- Webhookと毎分Cronは許可グループだけを対象にします。許可IDが未設定・仮値なら業務更新・送信は行いません。`GET /health`は固定の疎通文だけを返します。
- 許可外の予定は保持します。再許可すると送信対象になり得るため、許可ID変更前に旧グループの不要な予定を取り消してください。宛先・本文・再試行キーは新グループへ書き換えません。
- 内部IDは画面に表示せず、空の一覧でもリセット・再利用しません。登録確認はテキストだけです。一覧の取消ボタンから手入力なしで取り消せます。内容は最大2行で省略し、DB本文は保持します。取消ボタンは日時の右側です。取消後は内容・日時付きの結果テキストだけを返し、最新一覧は「リマインド」で取得します。文字取消コマンドは廃止し、入力しても返信しません。
- Cronは5分超の送信滞留を復旧し、同じ再試行キーで再送します。Push失敗は最大3回、初回claimから24時間以降は重複防止のため停止します。`sent`はLINEの受理を表し、端末への配送保証ではありません。送信開始済みのPushは取消で巻き戻せません。
- DB更新はイベント記録と原子的ですが、Reply送信とは原子的ではありません。更新成功後に返信だけ失敗する可能性があります。一覧の内容・長い返信・Pushは表示用に省略し、DBの内容は保持します。「次のページ」で続き、途中の追加・取消後は「リマインド」で更新してください。
- 初回デプロイは人間が手元で行います。更新用Actionsはproduction承認設定後に人間が有効化します。公開前に[レビューチェックリスト](docs/review-checklist.md)を確認してください。

[設計判断と既知の制約](docs/decisions.md)・[タスク](docs/tasks.md)・[開発規約](docs/conventions.md)・[検査仕様](docs/tooling.md)・[レビュー基準](docs/review-checklist.md)。ライセンスは[MIT](LICENSE)です。

---

## English

A shopping-list and one-time reminder bot for a LINE group, built with Cloudflare Workers, D1, and the LINE Messaging API. Dates are interpreted/displayed in Asia/Tokyo and stored in UTC. Bot commands and replies are in Japanese. The linked setup and operational guides are in Japanese.

### Commands

| Dummy input | Behavior |
|---|---|
| `+テスト品目A テスト品目B` | Add items separated by whitespace/newlines |
| `-テスト品目A` | Remove an item |
| `リスト` / `りすと` | Show the shopping list |
| `/テスト 明日15時` | Register a one-time reminder for tomorrow at 15:00 JST |
| `リマインド` | List unsent reminders in pages of five in one Flex message with content, JST time, and cancellation buttons to the right of the time (including sending/failed entries) |
| `ヘルプ` | Show usage |

Full-width characters are normalized; hiragana/katakana are unified when matching item names. Up to 20 items per message and 50 Unicode code points per name are accepted. Unrecognized messages and non-text events are ignored. Dates without a time default to 09:00; ambiguous hours 1–5 mean afternoon. Relative amounts must be unsigned integers. Month/day fields have one or two digits (`03/05` is valid, `003/5` is rejected). Specify one date/time within a year. Recurring reminders are unsupported; an interpretable weekly expression schedules one occurrence. See the [specification](docs/spec.md) and [date rules](docs/reminder-cases.md).

### Run your own instance

1. Obtain the repository, enter its root, and install [mise](https://mise.jdx.dev/). Make it available in your shell.
2. Review the checkout, then run:

   ```sh
   mise trust
   mise install
   mise exec -- pnpm install --frozen-lockfile
   mise exec -- pnpm check
   ```

   [mise.toml](mise.toml) is the only source of Node/pnpm versions.
3. Follow the [LINE setup guide](docs/line-setup.md): enable Messaging API, disable built-in greeting/auto-replies, allow group participation, and obtain a long-lived access token and channel secret.
4. Follow [deployment](docs/deploy.md), sections A → B0 → B: create D1, keep its ID in ignored `mise.local.toml`, generate the configuration, apply migrations before deploying code, then deploy/register Secrets from your own machine. Keep the tracked database ID as a placeholder.
5. Configure `<Worker URL>/webhook`, verify it and enable webhooks. Invite the bot, obtain the group ID from rejection logs, and set `ALLOWED_GROUP_ID`. Check that `ヘルプ` receives a reply.
6. Perform the [manual checks](docs/manual-test.md). For updates follow deployment section C and check the LINE account's Push allowance.

Required Secrets are `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, and `ALLOWED_GROUP_ID`. Never publish real IDs, tokens, secrets, or your Worker URL in repository files, issues, PRs, or chat. Follow the linked guides for the complete steps.

### Development and verification

Use deployment section B0 with dummy values for local signature checks. `mise exec -- pnpm dev` starts a local Worker; use the generated configuration from A/B0 when a database configuration is needed. Run:

```sh
TZ=UTC mise exec -- pnpm check
TZ=Asia/Tokyo mise exec -- pnpm check
```

The suite checks types, lint, unused code, dependencies, duplication, guards, and coverage using local D1 and mocked LINE clients. If a local secret file blocks the ID guard, verify in a separate checkout without secret files; do not print/change secret values or weaken the guard. CI checks both time zones and scans all Git history with gitleaks.

### Operational limits

Only the allowed group is processed by Webhook and the minute-based Cron. Missing/placeholder group settings prevent business mutations and sending. `GET /health` returns a fixed readiness text. Disallowed reminders remain stored and may become eligible if that group is allowed again: cancel unwanted old-group reminders before changing the setting. Stored recipients, bodies, and retry keys are never rewritten to the new group.

Internal IDs are hidden and are not reset/reused when the list becomes empty. Registration confirmations are text only. Lists have cancellation buttons that retain the internal ID; content is previewed in at most two lines without changing stored content. Cancellation replies contain the result, content, and JST time; send `リマインド` again for the current list. The text cancellation command has been removed and is ignored. Cron recovers sending entries after more than five minutes and reuses the same retry key. Push failures stop after three attempts; retries stop 24 hours after the first claim to avoid duplicates. LINE acceptance does not guarantee delivery. Cancellation cannot undo an already-started Push. Event records and business updates are atomic, but Reply delivery is separate and can fail after the update succeeds. List previews and long messages are shortened without changing stored content. Use the next-page button, or refresh with `リマインド` after adding/canceling entries.

Initial deployment is manual. Optional M8 updates use GitHub Actions after main checks and production Environment approval; a human must configure reviewers, branch restrictions, Environment secrets, and the enable variable first (deployment guide F). See [decisions and limitations](docs/decisions.md), [tasks](docs/tasks.md), [conventions](docs/conventions.md), [tooling](docs/tooling.md), [review checks](docs/review-checklist.md), and the [pre-PR checklist](docs/review-checklist.md). Licensed under [MIT](LICENSE).
