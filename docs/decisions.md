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

## 要確認（実装中に追記）
