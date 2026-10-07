# daffunda

LINEグループで使う買い物リストと単発リマインダーのBotです。Cloudflare Workers・D1・LINE Messaging APIで動作します。日時はAsia/Tokyoで解釈・表示し、UTCで保存します。

## 日本語

### できること

| 入力例（ダミー） | 動作 |
|---|---|
| `+テスト品目A テスト品目B` | 品目を追加。空白・改行で区切る |
| `-テスト品目A` | 品目を削除 |
| `リスト` / `りすと` | 買い物一覧 |
| `/テスト 明日15時` | 単発リマインダーを登録し、解釈した日時と番号を返信 |
| `リマインド` | 未送信の予定を表示（失敗・送信処理中も含む） |
| `リマインド削除 3` | 一覧・登録確認に表示された内部IDの予定を取消 |
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
- `#番号`は内部IDです。空の一覧でもリセット・再利用しません。取消ボタンは未実装です。
- Cronは5分超の送信滞留を復旧し、同じ再試行キーで再送します。Push失敗は最大3回、初回claimから24時間以降は重複防止のため停止します。`sent`はLINEの受理を表し、端末への配送保証ではありません。送信開始済みのPushは取消で巻き戻せません。
- DB更新はイベント記録と原子的ですが、Reply送信とは原子的ではありません。更新成功後に返信だけ失敗する可能性があります。長い返信・Pushは上限内へ省略し、DBの内容は保持します。
- デプロイは人間が手元で行います。公開前に[公開チェックリスト](docs/publish-checklist.md)を確認してください。

[設計判断と既知の制約](docs/decisions.md)・[タスク](docs/tasks.md)・[開発規約](docs/conventions.md)・[検査仕様](docs/tooling.md)・[レビュー基準](docs/review-checklist.md)。ライセンスは[MIT](LICENSE)です。

## English

A shopping-list and one-time reminder bot for a LINE group, built with Cloudflare Workers, D1, and the LINE Messaging API. Dates are interpreted/displayed in Asia/Tokyo and stored in UTC. Bot commands and replies are in Japanese. The linked setup and operational guides are in Japanese.

### Commands

| Dummy input | Behavior |
|---|---|
| `+テスト品目A テスト品目B` | Add items separated by whitespace/newlines |
| `-テスト品目A` | Remove an item |
| `リスト` / `りすと` | Show the shopping list |
| `/テスト 明日15時` | Register a one-time reminder for tomorrow at 15:00 JST |
| `リマインド` | List unsent reminders, including sending/failed entries |
| `リマインド削除 3` | Cancel the internal ID shown in the list or confirmation |
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

Reminder numbers are internal IDs and are not reset/reused when the list becomes empty. Cancellation buttons are a future task. Cron recovers sending entries after more than five minutes and reuses the same retry key. Push failures stop after three attempts; retries stop 24 hours after the first claim to avoid duplicates. LINE acceptance does not guarantee delivery. Cancellation cannot undo an already-started Push. Event records and business updates are atomic, but Reply delivery is separate and can fail after the update succeeds. Long messages are shortened for delivery without changing stored content.

Deployment is manual. See [decisions and limitations](docs/decisions.md), [tasks](docs/tasks.md), [conventions](docs/conventions.md), [tooling](docs/tooling.md), [review checks](docs/review-checklist.md), and the [publication checklist](docs/publish-checklist.md). Licensed under [MIT](LICENSE).
