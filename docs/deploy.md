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
- 手元で使う実在の `database_id` は `mise.local.toml`（gitignore 済み）の `D1_DATABASE_ID` に書く。M8のCI用にはGitHub Environment secretsにも登録する（F参照）

## 触るファイルの一覧
| ファイル | 内容 | コミット |
|---|---|---|
| `wrangler.toml` | `database_id` は `<YOUR_D1_DATABASE_ID>` のまま。編集しない | する（変更しない） |
| `mise.local.toml` | `[env]` に `D1_DATABASE_ID` | **しない** |
| `wrangler.generated.toml` | `scripts/gen-wrangler-config.sh` が生成。実 ID を含む | **しない** |
| `.dev.vars` | ローカルの `wrangler dev` 用のダミー値（B0 で使う）。実在の値は書かない | **しない**（gitignore 済み） |
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

## B0. デプロイ前のローカル確認（M5 のマージ後。デプロイの直前）

### 1. 配線の確認
| コマンド | OK の条件 |
|---|---|
| `grep -n "webhook" src/index.ts` | `POST /webhook` が、署名検証 → service → LINE クライアント（実際の `fetch` を使うもの）につながっている。テスト用のモックだけで終わっていない |
| `grep -nE "env\.|LINE_CHANNEL|ALLOWED_GROUP_ID" src/index.ts` | `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`ALLOWED_GROUP_ID` と D1 のバインディングを `env` から受け取っている |
| `grep -n "scheduled" src/index.ts` | M6 の前は無い、または空の実装のことがある。無い場合は、デプロイ後に Cron が毎分エラーログを出す可能性がある（害はない。M6 のマージ後に解消） |

### 2. 署名検証のローカル動作確認
署名の計算を、実装とは別の方法（`openssl`）で行って照合する。テストの期待値が実装側の誤解と一致していても、ここで検出できる。

1. `.dev.vars` を作る（gitignore 済み。ダミー値）
```
   LINE_CHANNEL_SECRET=dummy-secret-for-local
   LINE_CHANNEL_ACCESS_TOKEN=dummy-token
   ALLOWED_GROUP_ID=C_test_group_1
```
2. ターミナル1: `mise exec -- pnpm exec wrangler dev --config wrangler.generated.toml`
3. ターミナル2:
```sh
   BODY='{"destination":"U_test_destination","events":[]}'
   SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac 'dummy-secret-for-local' -binary | openssl base64)

   # (a) 正しい署名
   curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/webhook \
     -H "content-type: application/json" -H "x-line-signature: $SIG" --data-binary "$BODY"

   # (b) ボディを1文字変える
   curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/webhook \
     -H "content-type: application/json" -H "x-line-signature: $SIG" --data-binary "${BODY}x"

   # (c) ボディに空白を足す（整形に相当）
   curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/webhook \
     -H "content-type: application/json" -H "x-line-signature: $SIG" \
     --data-binary '{"destination": "U_test_destination", "events": []}'

   # (d) 署名ヘッダーなし
   curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/webhook \
     -H "content-type: application/json" --data-binary "$BODY"
```

| 送るもの | 期待する応答 |
|---|---|
| (a) 正しい署名、`events` が空 | **200**（LINE コンソールの［検証］ボタンも、`events` が空のボディに署名をつけて送る） |
| (b) ボディを改変 | **401** |
| (c) ボディに空白を追加 | **401**（検証の前にボディを整形・パースしていないことの確認） |
| (d) 署名ヘッダーなし | **401** |

`echo` ではなく `printf '%s'` を使う理由は、環境によって `echo` が末尾の改行や特殊文字を解釈するため。

### 3. 拒否ログの確認（任意）
許可されていない groupId のメッセージイベントを、正しい署名で送ると、**200 が返り、DB は変わらず、ログに `type` と ID だけが出る**ことを確認する。
ペイロードがスキーマ検証で弾かれる場合は、テストの fixtures にあるイベントを流用する（イベントの項目は公式のリファレンスを参照）。
確認後、`wr d1 execute <DB名> --local --config wrangler.generated.toml --command "SELECT count(*) FROM items"` で、件数が増えていないことを見る。

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

### 許可グループの変更（人間の運用）
- ALLOWED_GROUP_IDを変更する前に、旧グループで一覧を確認し、不要な予定を「リマインド削除 N」で取り消す。
- 未設定・仮値の間はCronも送信・DB変更を行わない。設定済みの場合はそのグループだけが送信・滞留復旧の対象になる。
- 許可外の予定は自動削除・取消されず、保存済みの宛先・本文・retry_keyも書き換わらない。
  旧グループを再び許可すると保持された期限到来予定が送信対象になり得る。既存retry_keyの24時間期限は延長しない。
- すでに開始した外部Pushは設定変更で取り消せない。設定変更後の新しいCron実行から許可ID判定が適用される。

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
| ローカルの署名確認で (a) が 401 になる | `.dev.vars` のシークレットと `openssl` に渡した鍵が同じか。`BODY` と `--data-binary` の本文が完全に同一か（シングルクォートで囲む）。末尾に改行が入っていないか（`printf '%s'`） |

## F. GitHub Actionsによるデプロイの事前準備（M8）

M8は任意。Codexはワークフローと手順を作成し、以下の画面設定・Secret登録・初回動作確認は人間が行う。
現在の `check.yml` は品質検査と秘密情報の検査だけで、デプロイは行わない。
既存のWorkerとD1を使い、本番でWebhookとCronが正常に動くことを先に確認する。

### 1. GitHub Environmentと手動承認

1. リポジトリの **Settings → Environments → New environment** を開く。
2. 名前を `production` にして **Configure environment** を押す。作成済みなら `production` を開く。
3. **Required reviewers** を有効にし、承認者として自分を登録する。
4. 1人で運用する場合は **Prevent self-review** をオフにする。オンだと自分が起動した実行を自分で承認できない。
5. **Allow administrators to bypass configured protection rules** をオフにし、**Save protection rules** で保存する。
6. 同じ画面の **Deployment branches and tags**（公式手順ではドロップダウンを **Deployment branches** と表記）で、
   **Selected branches and tags** を選ぶ。
7. **Add deployment branch or tag rule** → **Ref type: Branch** → 名前パターン `main` → **Add rule**。
   許可ルールはこのBranchの `main` だけにし、Tagやワイルドカードのルールは追加しない。

「mainだけを許可」という選択肢はなく、上記の順でルールを追加する。
**Protected branches only** は保護ルールがない場合に全ブランチを許可するため、main限定の代わりには使わない。

項目が見当たらない場合は、リポジトリ全体の **Settings → Branches / Rules** ではなく、
**Settings → Environments → production** の個別設定を開いているか確認する。
個人リポジトリでは所有者、Organizationではadmin権限が必要。
公開リポジトリでは現在のGitHub Freeを含め利用できるが、非公開ではプランによる制限がある。
特にFree/Pro/TeamのRequired reviewersは公開リポジトリのみ。
承認設定を利用できない場合はM8の手動承認条件を満たせないため、解決するまではCの手動デプロイを使う。

公式: [Environmentの設定手順](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)、
[ブランチ・タグ制限と承認規則](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。

### 2. CloudflareのCI用APIトークン

Cloudflareのプロフィールにある **API Tokens** から、**Edit Cloudflare Workers** テンプレートを基に作成する。
対象アカウントを既存Workerのあるアカウントに限定する。
D1マイグレーションも自動適用するワークフローでは、対象アカウントの **D1: Edit** 権限も追加する。
APIトークンの値は安全な場所に控え、チャット・ソース・ドキュメントに貼らない。
CIでは手元の `wr login` の認証は引き継がれない。

公式: [CloudflareのGitHub Actions連携](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、
[D1 APIトークンの権限設定](https://developers.cloudflare.com/d1/tutorials/import-to-d1-with-rest-api/)。

### 3. Environment secrets

**Settings → Environments → production → Environment secrets → Add secret** で、次の3つを登録する。
Repository secretsやEnvironment variablesではなく、承認後に使えるEnvironment secretsに登録する。

| 名前 | 内容 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 手順2で作成したCI用APIトークン |
| `CLOUDFLARE_ACCOUNT_ID` | 既存WorkerとD1があるCloudflareアカウントのID |
| `D1_DATABASE_ID` | 既存D1のID（手元の `mise.local.toml` と同じ対象） |

実際の値はGitHubの設定画面に直接入力する。Codexへの入力やコミットは不要。
CIでは `D1_DATABASE_ID` を環境変数として設定ファイル生成スクリプトへ渡す。
生成した `wrangler.generated.toml` は実IDを含むので、コミット・ログ出力・artifactへの保存をしない。
Cloudflareに登録済みの `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`ALLOWED_GROUP_ID` は、
既存Workerを使うためGitHubへ再登録しない。

### 4. M8のワークフローと初回確認

ワークフローはmainへのマージ後だけを対象にし、UTC/JSTの品質検査と全履歴の秘密情報検査が成功した後、
`production` の手動承認を待つ。承認後に設定生成 → リモートD1マイグレーション適用 → Workerデプロイの順で実行する。
PRからはデプロイしない。main限定はEnvironmentのルールとワークフローの両方で制限する。

人間はM8のマージ後、GitHub Actionsで検査成功・承認待ちになることを確認してから、対象コミットを確認して承認する。
適用・デプロイ成功後はCのログ確認と `docs/manual-test.md` の実機確認を行う。
ワークフローの作成だけで本番動作確認済みにはしない。M8完了前はCの手動デプロイを使う。


## F. M8: 承認付きGitHub Actionsで更新する（人間が設定・確認）

初回導入はA/B0/Bで行い、WorkerのLINE用Secretも引き続き人間が管理する。
M8はワークフローの作成のみ。エージェントはEnvironment設定・Secret登録・実デプロイ・リモートD1操作を実施しない。

### 有効化前の準備

1. GitHubのSettings → Environmentsで`production`を作り、Required reviewersを設定する。
   使用中の公開範囲・プランで承認機能が利用でき、承認前にジョブ/Secretが解放されないことを確認する。
   必要なら管理者による保護の迂回を無効にする。承認機能が使えない場合は有効化せず、Cの手動更新を使う。
2. Deployment branches and tagsを選択式にし、branch `main`だけを許可する（同名tagを許可しない）。
   mainのブランチ保護/rulesetではPR経由とUTC/JST check・secrets成功を必須にし、直接pushを防ぐ。
3. `production`のEnvironment secretsへ次の名前で登録する。値は手元で入力し、リポジトリ・PR・チャットに貼らない。
   - `CLOUDFLARE_API_TOKEN`: 対象アカウントのWorkers Scripts編集・D1編集に必要な最小権限のtoken。
   - `CLOUDFLARE_ACCOUNT_ID`: 対象アカウント。
   - `D1_DATABASE_ID`: Aで作成した既存DB。別DBを新規作成しない。
   Cloudflareの[GitHub Actions手順](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)と
   [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)で権限と移行を確認する。
   GitHubの[Environment保護](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)も参照する。
4. Environmentとmain保護を設定し終えた後だけ、Repository Actions variablesに
   `ENABLE_PRODUCTION_DEPLOY`を`true`として設定する。未設定・他の値ならdeployはスキップされる。
   この変数は承認の代替ではない。Environment承認の動作を確認せずtrueにしない。

### 更新・確認

1. PRをレビューしてmainへマージする。既存の`check`ワークフローでUTC/JST検査・全履歴gitleaksが成功するまで待つ。
2. `production`の承認画面で対象SHA・差分・マイグレーションを確認し、手動承認する。
   承認待ちの間にmainが進んだ古い実行は承認しない。実装も最新mainとSHAが異なると停止する。
3. 承認したSHAをcheckoutし、miseと固定lockfileでツールを導入してから、
   設定確認→最新SHA照合→生成設定→既存DBのマイグレーション→Worker公開を順に行う。
   実行中のデプロイは新しいpushでキャンセルしない。承認後の実行中はmainの更新を控える。
4. 公開後はB/Cの疎通と[実機確認](manual-test.md)を人間が実施する。実値やCLI出力は外部へ貼らない。
   エージェントのローカル/PR検査成功は本番承認・実デプロイ成功の代わりではない。

### 失敗・停止

- 設定不足・古いSHAならリモート操作前に停止。最新mainの正常な実行を確認する。
- D1移行失敗ならWorkerを公開しない。人間が手元で移行状態を確認し、互換性と原因を調べる。
- 移行成功後の公開失敗ではDBを自動で巻き戻さない。最新SHAと互換性を確認後、同じ実行を再実行/再承認する。
- CLI出力はIDやWorker URLを含み得るためActionsログ/成果物へ出さない。固定エラーだけを表示し、一時出力と生成設定は削除する。
- 自動更新を止めるにはRepository variableをfalseにし、既に承認待ちの実行も人間が却下/キャンセルする。
  実行中の移行/公開を途中で中断する判断は人間が行う。無効化は進行中の操作を巻き戻さない。

### 人間の確認記録（値は記録しない）

- production required reviewers・main限定・Secret登録・main保護: 未実施/OK/NG。
- mainマージ後の検査成功、承認前の停止、承認後の更新、PR時スキップ: 未実施/OK/NG。
- 公開後の実LINE・Cron確認: 未実施/OK/NG。対象SHAと固定エラーコードだけを記録する。
