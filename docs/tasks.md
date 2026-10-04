# タスク（すべてクラウドの Codex で実行）

- [x] S0 疎通スモーク（コミットなし）: ①公式 index.html.md の取得可否 ②npm registry への接続 ③mise・Node・pnpm の状態と PATH ④結果の報告のみ
- [x] M0a 足場（最小）: package.json(pnpm, packageManager なし), tsconfig(厳格フラグ), biome.json, vitest(workers pool),
      wrangler.toml(D1 はプレースホルダー, cron "* * * * *"), migrations/(空), .gitignore,
      src/ の土台(constants/messages/logger/index)、スモークテスト1本、pnpm-lock.yaml。
      mise.toml は人間が配置済み（変更しない）。install 時にビルドスクリプトで失敗した依存は、
      pnpm-workspace.yaml の allowBuilds で true/false を明示して理由を decisions.md に記録。
      pnpm check（typecheck+lint+test）が全緑。詳細は docs/tooling.md
- [ ] M0b 検査の追加: knip, jscpd, dependency-cruiser, scripts/(check-no-real-ids, check-sql, check-toolchain, check-suppressions, gen-wrangler-config),
      Biome のテスト関連ルール（skip・only の検出）, カバレッジ閾値, GitHub Actions(mise-action + pnpm check、gitleaks 全履歴)。
      pnpm check を全体に拡張して全緑。
      ※ .github/workflows をエージェントが push できない場合は、ファイルを PR 本文に貼って人間に渡す（それも実験結果として記録）
- [ ] M1 domain/normalize + domain/parser。parser-cases.md 全行を fixtures 化、整合性テスト、実装
- [ ] M2 domain/reminder-parse。reminder-cases.md 全行を fixtures 化、整合性テスト、実装（TZ 2種で通す）
- [ ] M3 repo + migrations（items, reminders, processed_events）。claim、滞留復旧
- [ ] M4 service（返信文、登録済み/見つからない/予約語/上限、リマインダー登録・一覧・削除、長いリストの分割または省略）
- [ ] M5 line/verify + Webhook 統合テスト（POST /webhook、署名不正→401、非許可group・未設定→200で無変更、events が空配列→200、
      再送で二重登録なし、拒否時ログに type と ID のみ。LINEクライアントはモック）
- [ ] M6 scheduled（Cron 送信、二重送信防止、リトライ、3回で failed、429 のログ。Push の再試行キーは公式で仕様確認のうえ採否を decisions.md に記録）
- [ ] M7a 整理周回（ふるまいを変えない。jscpd ゼロ化、関数分割、命名、constants/messages 集約）
- [ ] M7b README(日英。LINE の設定は docs/line-setup.md にリンクして要約する)、LICENSE(MIT)、docs/manual-test.md、decisions.md 整理、
      pnpm check の最終確認、test/fixtures の pending が0件であること（残る場合は PR 本文の「未解決」に理由を書いて人間の判断を待つ）
- [ ] R 自己レビュー周回（任意）: spec・AGENTS.md・conventions・tooling と全コードを突き合わせて逸脱を列挙し、修正と再発防止のテスト/規則追加を行う
- [ ] M8（任意・実験後）GitHub Actions による自動デプロイ。Environment secrets＋手動承認、main マージ後のみ。
      ワークフローを書くだけで、動作確認とシークレット登録は人間が行う
