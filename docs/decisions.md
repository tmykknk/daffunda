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

- D-18 M0a のビルド許可は、インストールが ERR_PNPM_IGNORED_BUILDS で失敗した esbuild と workerd のみ true。
  esbuild はバンドラーのプラットフォーム別バイナリの準備・検証、workerd は Workers テスト実行用バイナリの準備・検証に必要。
  strictDepBuilds は true を維持する。リリース直後の Hono に対して pnpm が自動追加した minimumReleaseAgeExclude は残さず、公開済みの前版を使用する。
- D-19 M0a は Workers プールの peerDependencies に合わせて Vitest と Istanbul を同一の対応版に固定し、Wrangler もプール内の版に合わせる。
  Vitest の設定は CommonJS の vitest.config.cts と export = を使い、noDefaultExport の例外を増やさない。
  ツール設定の型検査は tsconfig.tools.json で NodeNext を使い、Workers 本体・テストの厳格フラグは共通設定から維持する。
  Workers 本体と Vitest の型検査は tsconfig.test.json で分離し、Workers と Node/DOM のグローバル型の衝突を避ける。
  テストはプール内でエントリーポイントの fetch を呼び、userAgent が Cloudflare-Workers であることも検証する。
  プール 0.22.0 は Miniflare 5 の alpha 版に含まれる不足・不整合のある型定義で厳格な型検査に失敗したため、
  安定版 Miniflare 4 を使用するプール 0.19.1 と Wrangler 4.116.0 を採用する。skipLibCheck や抑制は使用しない。
- D-20 M0a の /health は足場の疎通確認のみ。LINE の受信・返信・署名検証・Cron の送信処理は対応マイルストーンで実装する。
- D-21 Miniflare 4.20260730.0 の配布型定義にも不正な内部パス参照があるため、pnpm の patchedDependencies で型定義のみ修正する。
  同梱の公開型への参照をパッケージ自身への参照に直し、PeriodType は同梱ソースマップの列挙値（10/60）を保持する。
  source-map-support のモジュール型、unique symbol の型、列挙型の typeof、MockAgent の Options 型を正しい参照に修正する。実行時コードは変更しない。
  配布型が参照する @types/ws と @puppeteer/browsers も開発依存として追加する。ブラウザーのダウンロード・起動は行わない。
- D-22 ローカル開発用の Wrangler 設定・キャッシュ・ログは無視対象の .wrangler/ に置く。
  pnpm dev はローカル専用で、テレメトリーと任意の Request.cf メタデータ取得を無効化して外部接続を不要にする。
  実際の Request.cf はローカルの既定値になるため、そのメタデータに依存する実装を追加する際は別途検証する。

## 要確認（実装中に追記）
