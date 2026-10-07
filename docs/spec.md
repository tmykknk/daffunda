# LINE 買い物リスト＆リマインダー Bot 仕様

## 構成
LINE Messaging API → Cloudflare Workers (Hono, TypeScript strict) → D1
リマインダー送信: Workers Cron Trigger（毎分、crons = ["* * * * *"]）
OSSとして公開する前提。環境固有の値は一切リポジトリに含めない。
Webhook: `POST /webhook`。例外として `GET /health` は固定の疎通確認文「準備完了」を200で返す。
秘密情報・DB内容は返さずDBへアクセスしない。他のパスは404。

## 共通ルール
- 受信テキストは NFKC 正規化 → trim してから解釈（＋→+、－→-、／→/、全角スペース→半角、全角数字→半角）
- 区切りは空白（半角・全角）と改行のみ。読点などは区切りにしない
- 下記コマンドに一致しないテキストは完全に無視（返信なし）。非テキスト（スタンプ・画像）も無視
- 返信は Reply API（無料枠を消費しない）。Push API はリマインダー発火時のみ
- 時刻は DB に UTC(ISO8601)、解釈と表示は Asia/Tokyo
- 予約語（品目名にできない）: リスト、りすと、ヘルプ、リマインド
- 1対1トークなど、groupId を持たないイベントは対象外（無視）。許可するのは ALLOWED_GROUP_ID と一致する groupId のみ

## コマンド
| 入力 | 動作 |
|---|---|
| `+牛乳 パン 卵` | 品目追加（`+ 牛乳` も可）。入力内の重複は1件に。既存と同名は「登録済み」と返す |
| `-牛乳 卵` | 品目削除。照合は norm_name（NFKC＋ひらがな→カタカナ統一）。同名複数なら古い1件。「削除: / 見つからない:」を分けて返信 |
| `リスト` / `りすと`（完全一致） | 買い物リスト表示。空なら「リストは空です」。長い場合はテキスト文字数上限（公式で確認）を超えないよう分割または末尾を「…他N件」と省略 |
| `/内容 日時` | リマインダー登録（docs/reminder-cases.md が正） |
| `リマインド` | 未送信リマインダー一覧（内容・JST日時・内部ID・取消をまとめたFlex、5件/ページ） |
| `リマインド削除 N` | リマインダー取消（自グループのもののみ） |
| `ヘルプ` | 使い方を返信 |
| `+` `-` `/` のみ、`リマインド削除` の引数不正 | 使用例を返信 |
| 予約語を `+` で追加 | 「その名前は使えません」を返信 |
| 1メッセージ21品目以上（重複排除後）、または品目名が51文字以上 | 上限エラーを返信 |

## リマインダー解釈
- chrono-node（日本語）を使用。LLMは使わない
- メッセージ全体から日時表現を抽出し、残りを内容とする。語順は問わない
- 補完ルールとエラー種別は docs/reminder-cases.md が正
- 登録成功時は解釈結果を絶対表記で返す（例: `登録 #3: 歯医者 → 10/4(日) 15:00`。取消は `リマインド削除 3`）
- 繰り返し（毎週・毎日など）は扱わない。「毎週月曜」のような入力は、解釈できた日時の単発として登録される（既知の挙動。decisions D-15）

## リマインダー取消ボタン
- 登録確認は内容・日時・内部ID・文字取消コマンドを含むテキストだけを返し、ボタンは付けない。
- 未送信一覧は日時順で5件ずつ、各予定の内容・JST日時・内部ID・「取消」ボタンを同じFlex Messageにまとめる。
  一覧テキストとボタンを別メッセージにしない。内容は最大2行で末尾を省略する。
  JSONサイズも抑えるため表示用の内容を300 UTF-16以内で短縮するが、DB内容は変更しない。
  続きは同じメッセージ内の「次のページ」で表示する。空一覧・空ページはテキストだけで案内する。
  serviceは通常テキストまたは構造化された一覧（ID・表示用内容・JST日時・次offset）を返し、line層でFlexへ変換する。
  完成した一覧文字列から内容やIDを逆解析しない。
  途中で予定が追加・取消された場合は「リマインド」で一覧を更新する。内部IDの振り直しは行わない。
- ボタンはバージョン付きpostbackデータに内部IDを保持する。署名・active・許可グループを操作時も再検証する。
  対象のgroup_idもSQLで照合する。別所属・存在しない予定は「見つからない」と案内し、状態や内容を開示しない。
- 取消後は結果のテキストだけを返信し、一覧を自動再送しない。最新一覧は再度「リマインド」で取得する。
  過去の登録確認に付いた取消ボタンも引き続き処理し、取消済み・送信済み・対象なしを状態に応じて案内する。
- pending/sending/failedは取消できる。取消済みなら「すでに取消済み」、sentなら「すでに送信済み」と案内する。
  取消・状態照会・イベント記録は同じ原子的バッチで行い、再送で業務更新・Replyを重複させない。
- #番号は内部IDで、一覧が空になってもリセット・再利用しない。完了・取消行は保持し、古いボタンで別予定を取り消せない。
  将来のデータ保管・削除を追加する場合も非再利用を維持する必要がある。
- 従来の「リマインド削除 N」は互換性のためそのまま使える。開始済み外部Pushは取消で巻き戻せない。

## 送信（Cron）
- ALLOWED_GROUP_IDが未設定・空・仮値（unsetやプレースホルダー等）ならDBを変更せず送信しない。
  設定済みなら一致するgroup_idの予定だけをclaim・送信・滞留復旧の対象とする。
  許可外の予定は削除・取消・宛先変更せず、その状態のまま保持する。
  そのグループを再び許可すると保持された予定が送信対象になり得る（再試行期限の制約は維持）。
  許可IDを変更する前に、旧グループの不要な予定を事前に取り消す。
- 毎分: group_id=ALLOWED_GROUP_ID AND status='pending' AND remind_at <= now を原子的に 'sending' へ更新して取得（UPDATE ... RETURNING）
- 送信対象がない回は何もせず、ログも出さない
- Push 成功 → 'sent'。失敗 → attempts+1 で 'pending' に戻し、3回失敗で 'failed'（失敗理由をログ。429 は特に明記）
- 'sending' のまま5分超のものは 'pending' に戻す（クラッシュ対策。at-least-once を許容）
- Push の二重送信対策に、リマインダーごとのUUID（retry_key）をX-Line-Retry-Keyとして付与する（decisions D-43）。
  初回claimでUUIDとretry_started_atを保存し、再試行・滞留復旧でも同じ宛先・本文・キーを使う。
  受理済みを示すヘッダー付き409は成功としてsentにする。初回claimから24時間以上ならPushせずfailedにし、attemptsは増やさない。
  token未設定・仮値はDBを変更せず送信しない。Pushは10秒でタイムアウトし、失敗時は次のCronで再試行する。
- 送信文: `⏰ リマインド: 歯医者`
- 送信先は reminders.group_id

## セキュリティ
- 署名検証: 生の body 文字列で HMAC-SHA256 → Base64 → 定数時間比較（詳細は公式で確認）。不正は 401、DB変更なし
- 非許可 groupId、および ALLOWED_GROUP_ID が未設定・仮値の間は、200 を返して何もしない（DB変更なし）。
  拒否時は、初期設定で groupId を調べられるよう `source.type` と ID（groupId / roomId / userId）だけをログに出す。メッセージ本文は出さない
- `events` が空配列のリクエスト（Webhook URL の検証など）も、署名が正しければ 200 を返す（公式で確認）
- SQL はバインドのみ。D1 アクセスは repo/ のみ
- Secrets: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, ALLOWED_GROUP_ID
  （公開リポジトリのため ALLOWED_GROUP_ID も vars ではなく Secret）
- 冪等性: webhookEventId を processed_events に保存し、再送で二重処理しない

## DB（D1 / SQLite）
items(
  id INTEGER PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL, norm_name TEXT NOT NULL,
  added_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), done_at TEXT)
  INDEX (group_id, done_at, norm_name)
reminders(
  id INTEGER PRIMARY KEY, group_id TEXT NOT NULL, content TEXT NOT NULL, remind_at TEXT NOT NULL,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/sending/sent/failed/canceled
  attempts INTEGER NOT NULL DEFAULT 0, retry_key TEXT, retry_started_at TEXT, sent_at TEXT, updated_at TEXT, claim_token TEXT)
  INDEX (status, remind_at)
processed_events(event_id TEXT PRIMARY KEY NOT NULL, operation_key TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
- claim_token は各claimの識別子。成功・失敗の更新は現在のclaimとの一致を条件にし、復旧・取消・完了時にクリアする。retry_keyとは別用途
- retry_started_atは初回claimのUTC時刻。retry_keyとともに再claimで変更せず、LINEの24時間管理期間を超える再送を防ぐ
- 複数品目の登録・削除は db.batch() で原子的に
- マイグレーションは migrations/ で管理し、テスト起動時に自動適用

## 設定ファイル
- wrangler.toml はコミットし、database_id は `<YOUR_D1_DATABASE_ID>` のプレースホルダー
- scripts/gen-wrangler-config.sh が環境変数 D1_DATABASE_ID から wrangler.generated.toml（gitignore）を生成し、デプロイはそれを使う
- 初回デプロイとSecret設定は人間がローカルから実行する。
  M8の更新用Actionsは、人間がproduction Environmentの承認・Secret・main制限を設定して有効化した場合のみ使える。
  mainへの反映後、UTC/JST検査とgitleaks成功→手動承認→最新SHA照合→D1マイグレーション→Worker公開の順で実行する。
  PRからは実行せず、設定不足・古いSHA・マイグレーション失敗は公開を止める。詳細はdocs/deploy.mdのFを参照。

## 受け入れ基準
- docs/parser-cases.md の全行（P-系）
- docs/reminder-cases.md の全行（R-系）
- 署名不正→401・DB変更なし / 非許可groupId→200・DB変更なし / 同一 webhookEventId の再送で登録1回のみ
- 同名2件で `-牛乳` → 古い1件のみ削除 / 未登録品目 → 「見つからない」
- `-みるく` で登録済み `ミルク` が削除できる（かな統一）
- Cron: 二重送信なし、失敗リトライ、3回失敗で failed、sending 滞留の復旧
