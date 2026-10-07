# LINE Messaging API セットアップ手順

> このファイルにも README にも、実際の ID・トークン・シークレット・Worker の URL を書かないこと。
> Cloudflare 側のコマンド（D1、デプロイ、Secret の登録、ログ）は docs/deploy.md を参照。

公式:
- LINE公式アカウントの開設: https://www.lycbiz.com/jp/manual/OfficialAccountManager/new_account/
- Messaging APIを始めよう: https://developers.line.biz/ja/docs/messaging-api/getting-started/
- ボットを作成する: https://developers.line.biz/ja/docs/messaging-api/building-bot/
- グループトークと複数人トーク: https://developers.line.biz/ja/docs/messaging-api/group-chats/
- チャネルアクセストークン: https://developers.line.biz/ja/docs/basics/channel-access-token/

## 0. 2つの画面の使い分け（最初に読む）

| 略称 | 画面 | URL | 主な用途 |
|---|---|---|---|
| **OA** | LINE Official Account Manager | https://manager.line.biz/ | アカウント作成、Messaging API の有効化、応答メッセージ・あいさつメッセージの変更 |
| **DEV** | LINE Developers コンソール | https://developers.line.biz/console/ | チャネルID・シークレット、Webhook URL、グループ参加の許可、QR コード、アクセストークンの発行 |

- OA にログインするときのアカウントで DEV にログインする
- 迷わないよう、ブラウザのタブを2つに分けて開き、手順ごとに [OA] [DEV] のどちらかを確認する

## 進める時期
| 時期 | 内容 |
|---|---|
| いつでも（コードに依存しない） | 2〜4、9。Cloudflare 側の事前準備（`wrangler login`、`wrangler d1 create`、`mise.local.toml`）は docs/deploy.md の A |
| M5 のマージ後 | 5〜6（初回デプロイ、Secret の登録、Webhook 設定、groupId の取得、実機確認）。Cloudflare 側は docs/deploy.md の B |
| M6 のマージ後 | リマインダーの発火確認、Push 無料枠の確認（docs/deploy.md の C で再デプロイ） |
| M7a のマージ後 | 再デプロイして挙動が変わっていないか確認 |

## 1. 作るもの・控えるもの

| 項目 | 取得場所 | 保存先 |
|---|---|---|
| チャネルシークレット | [DEV] チャネル → チャネル基本設定 | `wrangler secret put LINE_CHANNEL_SECRET` |
| チャネルアクセストークン（長期） | [DEV] チャネル → Messaging API設定タブ下部の「チャネルアクセストークン」→［発行］**初回デプロイの直前に発行する** | `wrangler secret put LINE_CHANNEL_ACCESS_TOKEN` |
| groupId | グループでの発言イベントのログ（5） | `wrangler secret put ALLOWED_GROUP_ID` |

どれもリポジトリ、README、Issue、チャットに貼らない。保存前の一時的な置き場は、パスワードマネージャーなどの手元の安全な場所にする。

## 2. LINE公式アカウントを作る [OA]
（LINEヤフー for Business「LINE公式アカウントの開設」2026-09-30 更新に基づく）
1. https://entry.line.biz/start/jp/ を開き、「LINE公式アカウントをはじめる」を選ぶ
2. ビジネスIDでログイン・登録する（LINEアカウントまたはメールアドレス）
   - メールアドレスで登録する場合: 登録用リンクのメールが届く → 氏名・パスワードの設定と規約への同意 → 登録
   - 登録後に **SMS認証**（携帯電話番号）または電話での認証が必要
3. アカウント作成に必要な項目を入力し、規約に同意する
   - **2025年6月25日以降、ビジネスマネージャー組織との接続が必須**。組織がなければ作成し、あれば既存の組織を選ぶ
   - 実施時の記録: 組織名がそのままアカウント名になった。アカウント名は後から変更しにくいので、組織名は慎重に決める
4. 「確認」→「アカウントを作成」。管理画面にログインできれば作成完了
5. 認証済アカウントの申請はしない（個人利用のため。§9 参照）

## 3. Messaging API を有効にする [OA]
1. LINE Official Account Manager の **WEB 版管理画面**にログインする（アプリ版では設定できない。管理者権限が必要）
2. 「設定」→「Messaging API」を開き、「Messaging APIを利用する」をクリックする
3. このアカウントで LINE Developers コンソールにログインしたことがない場合のみ、開発者情報（名前とメールアドレス）の登録画面が出る。出ない場合は何もせず次へ進む
4. **プロバイダーを作成または選択する。一度選ぶと後から変更・連携解除できない。** 今回の Bot 専用の新しいプロバイダーを作るのが無難
5. 「同意する」→ 確認画面で「OK」。チャネル ID とチャネルシークレットが発行される
6. [DEV] に同じアカウントでログインし、そのプロバイダーの下にチャネルが作成されていることを確認する
   （ここで見えれば、この手順は完了）

## 4. チャネルの設定

| 設定 | 画面 | 場所 | 値 |
|---|---|---|---|
| 応答メッセージ | 状態の確認は [DEV]、変更は [OA] | DEV: チャネル → Messaging API設定タブ → 応答メッセージの［編集］（押すと OA が開く） | **オフ**（既定は有効。Bot の応答と二重になるため） |
| あいさつメッセージ | 同上 | 同上 | **オフ**（既定は有効。混乱を避けるため最初はオフ） |
| グループトーク・複数人トークへの参加を許可する | [DEV] | チャネル → Messaging API設定タブ | **有効**（既定は無効。無効だとグループに招待できない） |
| チャネルシークレット | [DEV] | チャネル → チャネル基本設定 | 控える |
| チャネルアクセストークン（長期） | [DEV] | §1 のとおり | 初回デプロイの直前に**発行**して控える（公式の推奨は v2.1 だが、本プロジェクトは長期を採用: decisions D-18） |
| Webhook URL・Webhookの利用 | [DEV] | Messaging API設定タブ（5 で設定） | 5 を参照 |

1つのグループに同時に参加できる LINE 公式アカウントは1つだけ。

## 5. デプロイと Webhook 設定（M5 のマージ後）

Cloudflare 側のコマンド（マイグレーション、デプロイ、Secret の登録、ログの確認）は **docs/deploy.md の B** に従う。
LINE 側の操作は、deploy.md の B の手順に次のように挟む。

| deploy.md B の手順 | ここで行う LINE 側の操作 |
|---|---|
| 6 のデプロイ後 | Worker の URL を控える（外に出さない） |
| 7（Secret の登録の前） | [DEV] チャネルアクセストークン（長期）を発行する |
| 11 の後（Secret 登録後） | [DEV] Messaging API設定タブ → ［Webhook URL］の［編集］→ `<Worker の URL>/webhook` を入力 → ［更新］→［検証］で「成功」を確認 → ［Webhookの利用］を有効にする（HTTPS と、広く信頼された認証局の証明書が必要。自己署名証明書は不可） |
| 13 の後 | [DEV] QR コードから Bot を友だち追加。LINE アプリで2人のグループを作り Bot を招待し、グループで何か発言する |
| 15 | ログに `type: group` と `C` で始まる ID が出る。これを deploy.md 16 で `ALLOWED_GROUP_ID` に登録する |
| 17 | グループで `ヘルプ` を送り、返信が来ることを確認する |

控えた groupId を、他の場所（リポジトリ、README、Issue、チャット）に書かない。

## 6. 実機チェック
[実機確認手順](manual-test.md)と`docs/spec.md`の受け入れ基準に従い、次を確認する。
追加、削除（かな違いでも削除できるか）、リスト、雑談の無視、ヘルプ、同じイベントの再送で二重登録されないこと。
M6 のマージ後は、リマインダーの登録・一覧・取消・発火を確認する。見つかった問題は、次の Codex タスクの入力にする。

## 7. つまずきやすい点

| 症状 | 確認すること |
|---|---|
| どちらの画面で何をするか分からない | §0 の表。チャネル ID・シークレット・Webhook・トークン・グループ参加・QR は [DEV]、アカウント作成・Messaging API の有効化・応答メッセージの変更は [OA] |
| [DEV] にチャネルが見えない | §3 の手順（[OA] で「Messaging APIを利用する」）が済んでいるか。OA にログインしているのと同じアカウントで DEV に入っているか。別のプロバイダーを開いていないか |
| ［検証］が失敗する | URL の末尾が `/webhook` か、HTTPS か、Worker がデプロイ済みか、Secret が登録済み（空でない）か。`wrangler tail` で 401（署名不正）や 404 が出ていないか。空のイベントでも 200 を返す実装か |
| Bot が無反応 | ［Webhookの利用］が有効か。`wrangler tail` にイベントが届いているか。`ALLOWED_GROUP_ID` と実際の groupId が一致しているか |
| Bot が二重に返信する | 応答メッセージ・あいさつメッセージがオフか |
| グループに招待できない | ［グループトーク・複数人トークへの参加を許可する］が有効か。すでに別の公式アカウントが同じグループにいないか |
| リマインダーが届かない | Push 無料枠の上限、`wrangler tail` の 429、`reminders.status` の `failed` |
| 拒否ログに ID が出ない | `ALLOWED_GROUP_ID` の仮値のままで、グループ内で発言したか。1対1トークの発言は対象外 |
| wrangler・D1・Secret のコマンドで困った | docs/deploy.md の E |

## 8. セキュリティ
- 長期アクセストークンが漏洩した疑いがあれば、すぐに再発行する（再発行すると旧トークンは無効になる）
- Secret は `wrangler secret put` で登録し、`.dev.vars` はコミットしない
- 公開リポジトリには、グループ ID・ユーザー ID・Worker の URL・チャネル ID を書かない
- Push の無料枠の上限は、[OA] で確認する

## 9. 公開範囲（個人利用のため見つからないようにする）
LINE公式アカウントには「非公開」の状態がなく、ベーシックIDや友だち追加URLが分かれば誰でも友だち追加できる。次を守る。
- 認証済アカウントの申請をしない。Web版プロフィール、検索結果とおすすめへの表示は認証済アカウントだけの機能で、
  未認証アカウントにはその設定項目自体がなく、LINEアプリ内の検索にも出ない（設定でオフにする操作は不要）
- ベーシックID（@から始まる値）、友だち追加URL、QRコードを共有しない。プレミアムIDは取得しない
- クーポンを作成しない（作る場合は LINEヤフーサービスへの掲載を「掲載しない」にする）
- 第三者に友だち追加されても、許可された groupId 以外のイベントは無視される（仕様）
