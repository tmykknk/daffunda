# タスク（すべてクラウドの Codex で実行）

- [x] S0 疎通スモーク（ファイル変更・コミットなし。チェックも付けない）。次を実行し、出力をそのまま報告する:
      1. cat mise.toml
      2. mise --version、type -a mise node pnpm
      3. echo "$PATH" | tr ':' '\n'
      4. mise exec -- node -v、mise exec -- pnpm -v、mise exec -- which node
      5. bash -c 'which node pnpm mise' と bash -lc 'which node pnpm mise'
      6. tail -5 ~/.bashrc ~/.profile
      7. curl -s -D - -o /dev/null https://developers.line.biz/ja/reference/messaging-api/index.html.md のレスポンスヘッダー全文
      8. curl -s -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/hono
      9. 失敗した場合はエラー全文
- [x] M0a 足場（最小）: package.json(pnpm, packageManager なし), tsconfig(厳格フラグ), biome.json, vitest(workers pool),
      wrangler.toml(D1 はプレースホルダー, cron "* * * * *"), migrations/(空), .gitignore,
      src/ の土台(constants/messages/logger/index)、スモークテスト1本、pnpm-lock.yaml。
      mise.toml は人間が配置済み（変更しない）。install 時にビルドスクリプトで失敗した依存は、
      pnpm-workspace.yaml の allowBuilds で true/false を明示して理由を decisions.md に記録。
      pnpm check（typecheck+lint+test）が全緑。詳細は docs/tooling.md
- [x] M0b 検査の追加: knip, jscpd, dependency-cruiser, scripts/(check-no-real-ids, check-sql, check-toolchain, check-suppressions, gen-wrangler-config),
      Biome のテスト関連ルール（skip・only の検出）, カバレッジ閾値, GitHub Actions(mise-action + pnpm check、gitleaks 全履歴)。
      pnpm check を全体に拡張して全緑。
      ※ .github/workflows をエージェントが push できない場合は、ファイルを PR 本文に貼って人間に渡す（それも実験結果として記録）
- [x] M1 domain/normalize + domain/parser。parser-cases.md 全行を fixtures 化、整合性テスト、実装
- [x] M2 domain/reminder-parse。reminder-cases.md 全行を fixtures 化、整合性テスト、実装（TZ 2種で通す）
- [x] M3 repo + migrations（items, reminders, processed_events）。claim、滞留復旧
- [x] M4 service（返信文、登録済み/見つからない/予約語/上限、リマインダー登録・一覧・削除、長いリストの分割または省略）
- [x] M5 line/verify + Webhook 統合テスト（POST /webhook、署名不正→401、非許可group・未設定→200で無変更、events が空配列→200、
      再送で二重登録なし、拒否時ログに type と ID のみ。LINEクライアントはモック）。
      署名検証は公式「Webhookの署名を検証する」(https://developers.line.biz/ja/docs/messaging-api/verify-webhook-signature/) に従う:
      ボディは検証前にパース・整形・エスケープ解釈をしない（text/arrayBuffer で1回だけ読み、その値を検証に使い、あとで同じ値から JSON をパースする）、
      HMAC-SHA256・チャネルシークレットが鍵・Base64 で比較（定数時間）、ヘッダー欠落・不一致は 401 で DB と LINE API を呼ばない。
      テストには、openssl で独立に計算した固定の入力・署名のペア（ダミーの ID を使うこと）を1つ以上置く。
      次を必ずテストする: 正しい署名で200、ボディ改変・空白追加・ヘッダー欠落で401、events が空で200
- [x] M6 scheduled（Cron 送信、二重送信防止、リトライ、3回で failed、429 のログ。Push の再試行キーは公式で仕様確認のうえ採否を decisions.md に記録）
- [x] M7a 整理周回（ふるまいを変えない。jscpd ゼロ化、関数分割、命名、constants/messages 集約）
- [x] M7b README(日英。LINE の設定は docs/line-setup.md にリンクして要約する)、LICENSE(MIT)、docs/manual-test.md、decisions.md 整理、
      pnpm check の最終確認、test/fixtures の pending が0件であること（残る場合は PR 本文の「未解決」に理由を書いて人間の判断を待つ）
- [x] R 自己レビュー周回（任意）: spec・AGENTS.md・conventions・tooling と全コードを突き合わせて逸脱を列挙し、修正と再発防止のテスト/規則追加を行う
- [ ] M8（任意・実験後）GitHub Actions による自動デプロイ。Environment secrets＋手動承認、main マージ後のみ。
      ワークフローを書くだけで、動作確認とシークレット登録は人間が行う

- [x] I1 リマインダー取消ボタン（独立した改善タスク）:
      登録確認・一覧に内部IDを保持する取消ボタンを追加する。番号のリセット・再利用・一覧の振り直しは行わない。
      操作時に許可グループと対象の所属を検証し、古いボタンで別の予定を取り消せないことをテストする。
      取消済み・送信済みは状態に応じて案内し、「リマインド削除 N」は残す。
      実装前にLINE公式Markdownで具体的なメッセージ形式とイベント仕様を確認する（D-48）。
- [ ] I2 リマインダー一覧UIの改善（I1の表示仕様を変更）:
      登録確認はテキストだけにし、取消ボタンを付けない。
      「リマインド」の一覧は、各予定の内容・日時・内部ID・「取消」ボタンを
      同じFlex Message内にまとめる。一覧テキストとボタンを別メッセージにしない。
      日時順で1ページ5件、内容は最大2行で省略表示し、DBの内容は変更しない。
      続きは同じメッセージ内の「次のページ」で表示する。
      取消後は結果のテキストだけを返信し、一覧は自動再送しない。
      最新一覧は再度「リマインド」で取得する。空一覧もテキストだけで案内する。
      serviceは通常テキストと構造化された一覧を返し、line層でFlexに変換する。
      完成した一覧文字列から内容・IDを逆解析しない。
      既存postback形式・内部IDの非再利用・許可グループ/対象所属の検証・冪等性を維持する。
      過去の登録確認に付いたボタンも処理でき、取消済み・送信済み・対象なしを案内する。
      「リマインド削除 N」は維持する。新マイグレーション・依存追加は不要。
      実装前にLINE公式MarkdownでFlex・postback・Replyの該当仕様を確認する。
      テストを先に追加し、登録時ボタンなし、一覧と対象IDの対応、0/1/5/6件以上、
      長文・絵文字・長いID・ページ送り・取消結果のみの返信を検証する。
      古いボタン・他グループ・二重タップ・再送・DB失敗・Cron競合のテストを維持する。
      今回変更する表示仕様に限り期待値を更新し、理由をPR本文に記載する。
      spec・decisions・README・manual-testを更新し、UTC/JST両方でpnpm checkを通す。
      実LINEでの表示・操作確認とデプロイは人間が行い、未実施ならPR本文に明記する。
