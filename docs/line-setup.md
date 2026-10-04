# LINE Messaging API セットアップ手順

> 公式ドキュメントが正。画面の表記は変わることがある。
> このファイルにも README にも、実際の ID・トークン・シークレット・Worker の URL を書かないこと。

公式:
- Messaging APIを始めよう: https://developers.line.biz/ja/docs/messaging-api/getting-started/
- ボットを作成する: https://developers.line.biz/ja/docs/messaging-api/building-bot/
- グループトークと複数人トーク: https://developers.line.biz/ja/docs/messaging-api/group-chats/
- チャネルアクセストークン: https://developers.line.biz/ja/docs/basics/channel-access-token/

## 進める時期
| 時期 | 内容 |
|---|---|
| いつでも（コードに依存しない） | 2〜4、9、D1 の作成 |
| M5 のマージ後 | 5〜6（初回デプロイ、Webhook 設定、groupId の取得、実機確認） |
| M6 のマージ後 | リマインダーの発火確認、Push 無料枠の確認 |
| M7a のマージ後 | 再デプロイして挙動が変わっていないか確認 |

## 1. 作るもの・控えるもの

| 項目 | 取得場所 | 保存先 |
|---|---|---|
| チャネルシークレット | LINE Developers コンソール → チャネル → チャネル基本設定 | `wrangler secret put LINE_CHANNEL_SECRET` |
| チャネルアクセストークン（長期） | 同コンソール → Messaging API設定タブ → 発行 | `wrangler secret put LINE_CHANNEL_ACCESS_TOKEN` |
| groupId | グループでの発言イベントのログ（5-7） | `wrangler secret put ALLOWED_GROUP_ID` |

どれもリポジトリ、README、Issue、チャットに貼らない。

## 2. LINE公式アカウントを作る
1. ビジネスIDに登録する（LINEアカウントまたはメールアドレスで登録できる）
2. LINE公式アカウントの作成フォームに記入して作成する
3. LINE Official Account Manager（https://manager.line.biz/）で作成されたことを確認する

## 3. Messaging API を有効にする
1. LINE Official Account Manager で、作成したアカウントの Messaging API の利用を有効にする
2. 初めてなら、開発者情報（名前とメールアドレス）の登録画面が出る
3. **プロバイダーを選ぶ。一度選ぶと後から変更・連携解除できない。** 今回の Bot 専用の新しいプロバイダーを作るのが無難
4. LINE Developers コンソール（https://developers.line.biz/console/）に同じアカウントでログインし、チャネルが作成されていることを確認する

※ コンソールから Messaging API チャネルを直接作ることはできなくなっている（2024年9月〜）。

## 4. チャネルの設定

| 設定 | 場所 | 値 |
|---|---|---|
| 応答メッセージ | Messaging API設定タブ → 編集（Official Account Manager が開く） | **オフ**（Bot の応答と二重になるため） |
| あいさつメッセージ | 同上 | **オフ**（任意。混乱を避けるため最初はオフ） |
| グループトーク・複数人トークへの参加を許可する | Messaging API設定タブ | **有効**（既定は無効。無効だとグループに招待できない） |
| Webhookの利用 | Messaging API設定タブ | **有効**（Webhook URL を設定して検証が成功してから） |
| チャネルアクセストークン（長期） | Messaging API設定タブ | **発行**して控える |

1つのグループに同時に参加できる LINE 公式アカウントは1つだけ。

## 5. デプロイと Webhook 設定の順序（M5 のマージ後）

ALLOWED_GROUP_ID はグループに Bot を入れるまで分からない。そのため次の順序で進める。

1. D1 を作成し（`wrangler d1 create`）、マイグレーションを適用する。`database_id` は環境変数 `D1_DATABASE_ID` として手元で保持し、リポジトリには書かない
2. Secret を3つ登録する。**`ALLOWED_GROUP_ID` は仮の値**（例: `unset`）にしておく（未設定・仮値の間は全イベントを拒否する仕様）
3. `D1_DATABASE_ID` を環境変数で渡して `scripts/gen-wrangler-config.sh` を実行し、生成された設定でデプロイする
4. 表示された Worker の URL に `/webhook` を付けたものを、コンソールの **Webhook URL** に設定して［検証］を押し、**成功**を確認する。その後、［Webhookの利用］を有効にする
5. QR コード（Messaging API設定タブ）から Bot を友だち追加する
6. 2人のグループトークを作り、Bot を招待する
7. グループで何か発言し、`wrangler tail`（デプロイと同じ生成済み設定ファイルを `--config` で指定）で拒否ログを見る。ログに `type: group` と `C` で始まる ID が出る
8. その ID を `wrangler secret put ALLOWED_GROUP_ID` で登録する
9. グループで `ヘルプ` を送り、返信が来ることを確認する
10. 控えた groupId を、他の場所（リポジトリ、README、Issue、チャット）に書かない

## 6. 実機チェック
`docs/manual-test.md`（M7b で作成）がまだ無い間は、`docs/spec.md` の受け入れ基準を使って次を確認する。
追加、削除（かな違いでも削除できるか）、リスト、雑談の無視、ヘルプ、同じイベントの再送で二重登録されないこと。
M6 のマージ後は、リマインダーの登録・一覧・取消・発火を確認する。見つかった問題は、次の Codex タスクの入力にする。

## 7. つまずきやすい点

| 症状 | 確認すること |
|---|---|
| ［検証］が失敗する | URL の末尾が `/webhook` か、HTTPS か、Worker がデプロイ済みか。`wrangler tail` で 401（署名不正）や 404 が出ていないか。空のイベントでも 200 を返す実装か |
| Bot が無反応 | ［Webhookの利用］が有効か。`wrangler tail` にイベントが届いているか。`ALLOWED_GROUP_ID` と実際の groupId が一致しているか |
| Bot が二重に返信する | 応答メッセージ・あいさつメッセージがオフか |
| グループに招待できない | ［グループトーク・複数人トークへの参加を許可する］が有効か。すでに別の公式アカウントが同じグループにいないか |
| リマインダーが届かない | Push 無料枠の上限、`wrangler tail` の 429、`reminders.status` の `failed` |
| 拒否ログに ID が出ない | `ALLOWED_GROUP_ID` の仮値のままで、グループ内で発言したか。1対1トークの発言は対象外 |

## 8. セキュリティ
- 長期アクセストークンが漏洩した疑いがあれば、すぐに再発行する（再発行すると旧トークンは無効になる）
- Secret は `wrangler secret put` で登録し、`.dev.vars` はコミットしない
- 公開リポジトリには、グループ ID・ユーザー ID・Worker の URL・チャネル ID を書かない
- Push の無料枠の上限は、LINE Official Account Manager で確認する

## 9. 公開範囲（個人利用のため見つからないようにする）
LINE公式アカウントには「非公開」の状態がなく、ベーシックIDや友だち追加URLが分かれば誰でも友だち追加できる。次を守る。
- 認証済アカウントの申請をしない（未認証アカウントはLINEアプリ内の検索結果に出ない）
- ベーシックID、友だち追加URL、QRコードを共有しない。プレミアムIDは取得しない
- Official Account Manager のビジネスプロフィールで、Web版プロフィールの公開をオフにする
- クーポンを作成しない
- 第三者に友だち追加されても、許可された groupId 以外のイベントは無視される（仕様）
