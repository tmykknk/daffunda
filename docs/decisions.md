# 設計判断

- D-01 返信は Reply API。Push はリマインダー発火時のみ（Push は無料枠を消費。グループ宛ては受信者数ぶん）
- D-02 非許可 groupId は 200 で無視（LINE側で失敗扱いにしない）。署名不正のみ 401
- D-03 ALLOWED_GROUP_ID は Secret（公開リポジトリのため）
- D-04 日時解釈は chrono-node(ja) のみ。LLM は使わない（無料・決定的・テスト可能）
- D-05 区切りは空白と改行のみ。コマンドは先頭の + - / と完全一致の語のみ。雑談は無視
- D-06 日時表現が複数ある場合は曖昧としてエラー
- D-07 時刻は UTC 保存、解釈・表示は Asia/Tokyo
- D-08 wrangler.toml はプレースホルダー、デプロイ時に gen-wrangler-config.sh で生成
- D-09 リマインダー送信は at-least-once。claim 後に失敗したら最大3回リトライ
- D-10 実在IDの混入は scripts/check-no-real-ids.sh と gitleaks で機械的に防ぐ
- D-11 ツールチェーンは mise（mise.toml）で一元管理。corepack と packageManager フィールドは使わない
- D-12 デプロイは人間がローカルから実行する。GitHub Actions による自動デプロイ（CD）は今回は作らない
  （Cloudflare API トークンを公開リポジトリのシークレットに置かないため）。必要になれば M8 として別途追加する
- D-13 LINE API の仕様は公式の Markdown 版を直接参照する。独自のメモファイルは作らない
- D-14 リマインダー送信の Cron は毎分（他の Worker がほとんど動いておらず、相対指定「30分後」などの精度を優先）
- D-15 繰り返しリマインダーは想定しない。「毎週月曜」のような入力は、解釈できた日時の単発として登録される（既知の挙動）
- D-16 抑制コメントは例外なしで禁止。scripts/check-suppressions.sh と Biome のルールで二重に検出する
- D-17 依存のビルドスクリプトは pnpm-workspace.yaml の allowBuilds で明示的に管理する（pnpm 11 以降の仕組み。旧設定は使わない）
- D-18 チャネルアクセストークンは長期トークンを使う（コンソールで手動発行、Secret に登録）。個人利用で友だちが少なく、
  トークンを Wrangler の Secret にのみ置く運用のため。漏洩時は再発行で旧トークンを失効させる。
  ステートレストークンや v2.1 への移行は、実験後の強化として検討する
- D-19 Webhook のパスは POST /webhook。groupId の初回取得は、拒否時ログ（type と ID のみ）から行う
- D-20 M0a のビルド許可は、インストールが ERR_PNPM_IGNORED_BUILDS で失敗した esbuild と workerd のみ true。
  esbuild はバンドラーのプラットフォーム別バイナリの準備・検証、workerd は Workers テスト実行用バイナリの準備・検証に必要。
  strictDepBuilds は true を維持する。リリース直後の Hono に対して pnpm が自動追加した minimumReleaseAgeExclude は残さず、公開済みの前版を使用する。
- D-21 M0a は Workers プールの peerDependencies に合わせて Vitest と Istanbul を同一の対応版に固定し、Wrangler もプール内の版に合わせる。
  Vitest の設定は CommonJS の vitest.config.cts と export = を使い、noDefaultExport の例外を増やさない。
  ツール設定の型検査は tsconfig.tools.json で NodeNext を使い、Workers 本体・テストの厳格フラグは共通設定から維持する。
  Workers 本体と Vitest の型検査は tsconfig.test.json で分離し、Workers と Node/DOM のグローバル型の衝突を避ける。
  テストはプール内でエントリーポイントの fetch を呼び、userAgent が Cloudflare-Workers であることも検証する。
  プール 0.22.0 は Miniflare 5 の alpha 版に含まれる不足・不整合のある型定義で厳格な型検査に失敗したため、
  安定版 Miniflare 4 を使用するプール 0.19.1 と Wrangler 4.116.0 を採用する。skipLibCheck や抑制は使用しない。
- D-22 M0a の /health は足場の疎通確認のみ。LINE の受信・返信・署名検証・Cron の送信処理は対応マイルストーンで実装する。
- D-23 Miniflare 4.20260730.0 の配布型定義にも不正な内部パス参照があるため、pnpm の patchedDependencies で型定義のみ修正する。
  同梱の公開型への参照をパッケージ自身への参照に直し、PeriodType は同梱ソースマップの列挙値（10/60）を保持する。
  source-map-support のモジュール型、unique symbol の型、列挙型の typeof、MockAgent の Options 型を正しい参照に修正する。実行時コードは変更しない。
  配布型が参照する @types/ws と @puppeteer/browsers も開発依存として追加する。ブラウザーのダウンロード・起動は行わない。
- D-24 ローカル開発用の Wrangler 設定・キャッシュ・ログは無視対象の .wrangler/ に置く。
  pnpm dev はローカル専用で、テレメトリーと任意の Request.cf メタデータ取得を無効化して外部接続を不要にする。
  実際の Request.cf はローカルの既定値になるため、そのメタデータに依存する実装を追加する際は別途検証する。

- D-25 M0b のガードは共通の Node スクリプトを POSIX sh から呼び出す。SQL は TypeScript の構文木を使い、
  コメント・文字列の誤検出を避けつつ、複数行・括弧付きの連結やテンプレートも拒否する。
  ID 検査は docs を含む全体、抑制検査は tooling.md の対象に適用する。エラーには検出箇所のみを出し、内容は出さない。
  設定生成は英数字・ハイフン・アンダースコアだけの D1_DATABASE_ID を受け入れ、元の wrangler.toml を変更しない。
- D-26 M0b の knip が D-23 のルート開発依存2件を未使用と検出したため、Miniflare の packageExtensions に移す。
  配布型が必要とする依存を実際の所有パッケージに宣言し、knip の除外や型検査の緩和は追加しない。
  patchedDependencies・strictDepBuilds・allowBuilds は維持し、新しいビルド許可は追加しない。
- D-27 Vitest は Workers 本体のテストと Node 上の検査ツールのテストを別プロジェクトで実行する。
  本体は test/tooling 以外の test/**/*.test.ts、ツールは test/tooling/**/*.test.ts を対象とする。
  src 全体を Istanbul で測定し、全体85%・domain95%・service90%を文・分岐・関数・行すべてに適用する。
  定数の仕様整合性と例外時の安全なログをテストし、測定対象の除外は増やさない。
  未実行の domain 関数を一時的に追加する検証でも、全体と domain の閾値違反で失敗することを確認した（検証用ファイルは削除）。
- D-28 CI は mise.toml だけからツールを導入し、UTC と Asia/Tokyo で pnpm check を実行する。
  別ジョブで全履歴を gitleaks 8.30.1 の CLI で検査する。公式配布アーカイブのチェックサムを検証し、出力は redact する。
  外部 Action はコミット SHA 固定、権限は contents: read のみとし、デプロイやシークレット登録は行わない。
  依存規則の拒否テストで pnpm の Hono 実体パスを見落とす問題を検出し、node_modules の深い配置にも規則を適用した。

- D-29 M1 の parser は NFKC＋trim 後の表示名を返す。入力内の重複排除はその表示名の一致で行い、
  照合用のひらがな→カタカナ統一は normalizeName に分離する。入力順は保持し、半角カナは NFKC 後に重複排除する。
  品目名の50文字は Unicode コードポイント数で数える。品目数・名前長の上限は追加・削除の両方に適用し、
  上限判定を予約語判定より先に行う。予約語の拒否は追加だけに適用し、該当語を入力順でまとめる。
  リマインド削除は独立したコマンド語と引数1個に一致する場合だけ解釈する。IDは数字だけの正の安全整数とし、
  全角数字や先頭ゼロは正規化して受け入れる。小数・符号・指数表記・余分な引数・精度を失う整数は使用例を返す。
  reminder の raw は日時解釈をせず、NFKC・前後trim後の内部空白と改行を維持する（日時処理は M2）。
- D-30 M1 の fixtures は P-01〜P-34 の全34行。Markdown のID・順序・入力・期待値との完全一致を検証する。
  P-30 の反復表現と P-33/P-34 の改行表現は表の指示どおりに実際の文字列へ展開する。
  fixtures を読む整合性・parser テストは既存の Node プロジェクト、normalize は Workers プロジェクトで実行し、設定変更はしない。
  ItemCommand の default は `return command satisfies never` によりコンパイル時に網羅性を検査する。
  never の変数宣言と return の2文を同等の型制約の1文に置き換え、到達不能な分岐を測定対象に残したまま95%を満たす。
  閾値・測定対象・期待値は変更せず、抑制や不可能な分岐を実行するための型断言も使用しない。

- D-31 M2 は仕様指定の chrono-node が M0 で未導入だったため、実行時依存として 2.10.2 を追加する。
  M0a/M0b 以外での依存追加の必要性をここに記録し、PR 本文にも明示する。mise・検査設定・ビルド許可は変更しない。
  parseReminder の成功結果は DB 保存に使える UTC ISO8601（秒・ミリ秒は0）を返し、fixtures の期待値は指定どおり JST の分精度を維持する。

- D-32 chrono-node 2.10.2 の日本語版では N分後・N時間後・N日後・月末・一部時間帯語・明後日を抽出できず、
  既定時刻や今週・来週の解釈も仕様と異なることを実測した。domain の前処理で具体的な日時表現に補い、chrono で抽出・日時結合する。
  抽出後は既定09:00、午前/午後なしの1〜5時、時刻のみの翌日補完、月日の翌年補完を適用する。
  暦の演算はJSTオフセットとUTCフィールドだけで行い、nowを変更せず、ホストのTZに依存しない。
  日時が複数または範囲なら MULTIPLE、来月・そのうちや抽出後に残った不正な日時表現は UNPARSEABLE。
  内容なし・日時なし・現在時刻以前・1年上限超を各コードで返す。現在と同じ時刻も安全側に過去として扱い、時刻のみなら翌日へ補完する。
  毎週X曜はD-15に従い次のX曜の単発として解釈する。LINE API・DB・Cronへの接続は今回行わない。
- D-33 年のない2/29は現在年に存在しないとき、翌年に存在すればその日で解釈し、1年上限も適用する。
  過去の2/29を翌年へ補完した結果その日が存在しない場合は UNPARSEABLE とし、JavaScriptの3/1への繰り上げは許さない。
  nowが2/29の場合の1年上限は翌年2/28の同時刻に丸める（安全側の暦年の解釈）。再現テストを先に追加して検証した。
  R-01〜R-33は全33行をfixtures化し、MarkdownのID・順序・入力・期待値との完全一致を検証する。
  規定のJST表記の期待値は変更せず、UTC結果をテストでJSTの分精度へ変換して比較する。Workersでのchrono実行もテストする。

- D-34 M3 は D1 行の境界検証に仕様指定の valibot 1.5.0 を実行時依存として追加する。
  D1 テストには既存 Workers プールの readD1Migrations と applyD1Migrations を使い、実際の migrations/ を自動適用する。
  必要な依存・Vitest の設定追加をここに記録し、PR 本文にも明示する。mise・閾値・lint・ビルド許可は変更しない。

  Workers の仮想モジュールには実行時に提供されるAPIの狭い型宣言を置き、Node側テストのグローバル型との衝突を避ける。
  knip 6.39.0 は cloudflare:test / cloudflare:workers のコロン以降を落として解決するため、
  paths の cloudflare をその型宣言に対応させる。ignoreDependencies・検査除外は追加しない。
- D-35 created_at の既定値も UTC ISO8601 に統一し、spec のDB定義を実際のマイグレーションに合わせる。
  品目の照合インデックスは非uniqueとし、既存同名行を古い作成日時・ID順で1件だけ削除できるようにする。
  DBに空のグループ・名前・内容・イベントID、未知の状態、0〜3外の試行回数を保存しない制約を置く。
- D-36 updated_at だけでは同じミリ秒の再claimを区別できないため、claim_tokenを追加する。
  原子的UPDATEでclaimごとのUUIDを保存し、成功・失敗はID・グループ・sending・claim_token一致の場合だけ更新する。
  取消・滞留復旧・成功・失敗時に識別子をクリアし、旧claimの遅れた更新を拒否する。
  このUUIDは内部の処理識別用であり、LINE Pushのretry_keyとは共有しない。retry_keyの採否はM6で公式確認する。
  未送信一覧・取消はpending/sending/failedを対象とし、sent/canceledを除外する。5分ちょうどのsendingは復旧せず、5分超のみ戻す。
  processed_eventsは原子的な記録・取得だけを実装し、Webhookとの統合はM5、Push/Cronとの統合はM6で行う。

- D-37 M4 はLINE公式Markdownの「テキストメッセージ」（最大5000・UTF-16符号単位）と
  「応答メッセージを送る」（messages最大5件）を実装前に確認した。
  serviceは返信テキスト1件または無視のnullを返し、API呼び出し・Webhookへの接続はM5で行う。
  買い物・未送信一覧は順序と行を保ち、上限に収まらない行から「…他N件」で省略する。
  最初の行が上限を超える場合は省略件数だけを返す。DBの内容を短縮・削除しない。
  長い登録確認は内容だけをUnicodeコードポイント単位で短縮し、ID・JST日時・取消コマンドを必ず残す。
- D-38 追加・削除結果はrepoの変更行からnorm_name別件数を数え、入力順に1件ずつ割り当てる。
  かな別名で1件しか存在しないときも複数の成功として返信しない。表示には入力名を使う。
  返信文・使用例・日時解析の全6種のエラー文はmessages.ts、公式上限はconstants.tsへ集約する。
  DBエラーは成功返信へ変換せず、上位のエラーハンドラーへ伝える。retry_keyはM6の判断まではnullで保存する。

## 要確認（実装中に追記）
