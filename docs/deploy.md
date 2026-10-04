# デプロイ手順（人間が手元で実行する）

> Cloudflare 側のコマンドと、デプロイの順序をまとめる。LINE 側の画面操作は docs/line-setup.md。
> Codex は wrangler の deploy / secret / --remote 付き d1 コマンドを実行しない（AGENTS.md の禁止事項）。
> このファイルにも、実際の ID・トークン・Worker の URL を書かない。

## 前提
- リポジトリのルートで実行する
- 依存関係: `mise install && mise exec -- pnpm install --frozen-lockfile`
- wrangler はグローバルではなくプロジェクトの devDependency。次の別名を使う（シェルのセッションごとに設定）:
  `alias wr='mise exec -- pnpm exec wrangler'`
- `<DB名>` は wrangler.toml の `[[d1_databases]]` の `database_name` の値
- 実在の `database_id` は `mise.local.toml`（gitignore 済み）の `D1_DATABASE_ID` にだけ書く

## 触るファイルの一覧
| ファイル | 内容 | コミット |
|---|---|---|
| `wrangler.toml` | `database_id` は `<YOUR_D1_DATABASE_ID>` のまま。編集しない | する（変更しない） |
| `mise.local.toml` | `[env]` に `D1_DATABASE_ID` | **しない** |
| `wrangler.generated.toml` | `scripts/gen-wrangler-config.sh` が生成。実 ID を含む | **しない** |
| `.gitignore` | `mise.local.toml`、`wrangler.generated.toml`、`.dev.vars`、`.wrangler` を含む | する |

## A. 事前準備（いつでも。M5 を待たなくてよい）
| # | コマンド | 内容 |
|---|---|---|
| 1 | `wr login` | ブラウザで Cloudflare の認証を許可する |
| 2 | `wr whoami` | ログイン確認（出力のアカウント ID は貼らない） |
| 3 | `wr d1 create <DB名>` | D1 を作成。出力の `database_id` を控える。設定ファイルへの追記の確認が出たら **n** |
| 4 | `mise.local.toml` を作成 | `[env]` の `D1_DATABASE_ID = "<手順3の値>"` |
| 5 | `git status` | `mise.local.toml` が出ないこと |
| 6 | （任意）ローカル検証 | 下の「ローカルでのマイグレーション検証」 |

### ローカルでのマイグレーション検証（任意）
1. `mise exec -- sh scripts/gen-wrangler-config.sh`
2. `wr d1 migrations apply <DB名> --local --config wrangler.generated.toml`
3. `wr d1 execute <DB名> --local --config wrangler.generated.toml --command "SELECT name FROM sqlite_master WHERE type='table'"`
   → items、reminders、processed_events が出ること

## B. 初回デプロイ（M5 のマージ後）
| # | コマンド・操作 | 内容 |
|---|---|---|
| 1 | `git pull`、`mise install`、`mise exec -- pnpm install --frozen-lockfile` | M5 までを取り込む |
| 2 | `mise exec -- pnpm check` | 手元でも全緑か確認（任意） |
| 3 | `mise exec -- sh scripts/gen-wrangler-config.sh` | `wrangler.generated.toml` を生成 |
| 4 | `wr d1 migrations list <DB名> --remote --config wrangler.generated.toml` | 未適用のマイグレーションを確認 |
| 5 | `wr d1 migrations apply <DB名> --remote --config wrangler.generated.toml` | **`--remote` を付ける**。確認で y |
| 6 | `wr deploy --config wrangler.generated.toml` | デプロイ。出力された Worker の URL を控える（外に出さない）。初回は workers.dev のサブドメイン登録を求められることがある |
| 7 | [DEV] チャネルアクセストークンを発行 | 直前に発行する（line-setup.md §4） |
| 8 | `wr secret put LINE_CHANNEL_SECRET --config wrangler.generated.toml` | 対話プロンプトに値を貼る |
| 9 | `wr secret put LINE_CHANNEL_ACCESS_TOKEN --config wrangler.generated.toml` | 同上 |
| 10 | `wr secret put ALLOWED_GROUP_ID --config wrangler.generated.toml` | 値は仮（`unset`） |
| 11 | `wr secret list --config wrangler.generated.toml` | 3つの名前が並ぶことを確認 |
| 12 | [DEV] Webhook URL を設定して［検証］ | `<Worker の URL>/webhook`（line-setup.md §5-4） |
| 13 | `wr tail --config wrangler.generated.toml` | 別のターミナルで起動したままにする（ログ確認用） |
| 14 | LINE: 友だち追加 → グループ作成 → Bot を招待 → グループで発言 | line-setup.md §5-5〜7 |
| 15 | 13 のログから、`type: group` と groupId（`C` で始まる）を確認 | 他の場所に書かない |
| 16 | `wr secret put ALLOWED_GROUP_ID --config wrangler.generated.toml` | 本物の groupId に更新 |
| 17 | グループで `ヘルプ` を送る | 返信が来れば完了 |

注意:
- secret は空で登録しない。対話プロンプトで入力する。パイプやリダイレクトで渡す場合は値が空でないことを確認する
- `d1 ... --remote` の `--remote` を付け忘れると、ローカルの D1 にだけ適用されて本番は空のまま
- Webhook の［検証］は、手順8〜10（Secret の登録）の後に行う（署名検証に LINE_CHANNEL_SECRET が必要なため）

## C. 再デプロイ（M6・M7a のマージ後、または修正のたび）
| # | コマンド | 内容 |
|---|---|---|
| 1 | `git pull`、`mise exec -- pnpm install --frozen-lockfile` | 最新を取り込む |
| 2 | `mise exec -- sh scripts/gen-wrangler-config.sh` | 設定ファイルを再生成（wrangler.toml が変わった場合に必須） |
| 3 | `wr d1 migrations list <DB名> --remote --config wrangler.generated.toml` | 新しいマイグレーションがあるか確認 |
| 4 | あれば `wr d1 migrations apply <DB名> --remote --config wrangler.generated.toml` | **デプロイより先**に適用（先にコードだけ更新すると、無いテーブルを参照して失敗する） |
| 5 | `wr deploy --config wrangler.generated.toml` | デプロイ |
| 6 | `wr tail --config wrangler.generated.toml` | ログで確認 |

## D. よく使うコマンド（確認・調査）
| 目的 | コマンド |
|---|---|
| ログをリアルタイムで見る | `wr tail --config wrangler.generated.toml` |
| リモートの D1 を読む | `wr d1 execute <DB名> --remote --config wrangler.generated.toml --command "SELECT ..."` |
| 登録済みの Secret の名前 | `wr secret list --config wrangler.generated.toml` |
| Secret の削除 | `wr secret delete <名前> --config wrangler.generated.toml` |
| マイグレーションの状態 | `wr d1 migrations list <DB名> --remote --config wrangler.generated.toml` |

## E. つまずきやすい点
| 症状 | 確認すること |
|---|---|
| `wrangler: command not found` | `wr`（`mise exec -- pnpm exec wrangler`）を使っているか。`pnpm install` 済みか |
| 認証エラー（D1 の操作で権限不足など） | `wr login` をやり直す |
| `no such table` | `--remote` 付きでマイグレーションを適用したか。デプロイより先に適用したか |
| ［検証］が失敗する | line-setup.md §7。Secret が登録済みか（空でないか）も確認 |
| `database_id` が見つからない・不正 | `mise.local.toml` が正しいか。`gen-wrangler-config.sh` を `mise exec -- ` 付きで実行したか（付けないと環境変数が渡らない） |
| 生成した設定ファイルが `git status` に出る | `.gitignore` に `wrangler.generated.toml` が無い。追記する |
