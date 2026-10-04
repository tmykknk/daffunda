---
name: add-bot-command
description: Botに新しいコマンド（入力形式）を追加するときの定型手順
---

# 手順
1. docs/spec.md のコマンド表に行を追加し、予約語の衝突を確認する
2. docs/parser-cases.md に正常系・異常系・境界値のケースを追加（IDは連番）
3. test/fixtures/parser-cases.json に転記し、整合性テストが通ることを確認
4. 失敗するテストを先に書く → parser → service → 返信文(src/messages.ts) の順に実装
5. pnpm check を通し、README のコマンド一覧を更新
