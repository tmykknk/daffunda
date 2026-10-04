---
name: line-api-check
description: LINE Messaging API に関わるコード（署名検証、Webhookイベント、Reply/Push、メッセージ送信）を実装・変更する前に、公式リファレンスで仕様を確認する手順
---

# 手順
1. 公式（Markdown版）の該当節を読む: https://developers.line.biz/ja/reference/messaging-api/index.html.md 読めない場合は AGENTS.md の「取得できない場合」の手順に従う
2. 次を確認し、実装またはテストのコメントに根拠（節名）を残す
   - Webhook: リクエストヘッダー、署名の検証方法、レスポンス（返すべきステータス）、共通プロパティ（webhookEventId、redeliveryContext、source、replyToken、mode）
   - 応答メッセージ: replyToken の制約、1リクエストのメッセージ数上限、テキストの文字数上限
   - プッシュメッセージ: 宛先、メッセージ数の扱い、再試行キー（X-Line-Retry-Key）の仕様
   - レート制限とエラーレスポンス（429 など）
3. 確認できなかった点は docs/decisions.md の「要確認」に追記し、安全側に実装する
