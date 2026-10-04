# 公開前チェックリスト（人間が実施）

- [ ] CI の gitleaks（全履歴）が緑。ローカルでも `gitleaks detect --source . --log-opts="--all"` で指摘なし
- [ ] `sh scripts/check-no-real-ids.sh` が通る
- [ ] `git grep -nE "(U|C|R)[0-9a-f]{32}"` が0件
- [ ] wrangler.toml の database_id がプレースホルダー、wrangler.generated.toml が追跡されていない
- [ ] テスト・README・docs に実名、住所、実在の家庭の品目、実際の Worker URL が含まれない
- [ ] GitHub Actions: pull_request_target を使っていない。外部 Action はSHA固定。デプロイ用シークレットを CI に置いていない
- [ ] LICENSE と README がある（README に自分の環境で動かす手順）
- [ ] 公開後に Settings → Branch protection（main への直接 push 禁止）
- [ ] 問題があれば履歴を直してから public にする（公開後の履歴書き換えは漏洩済みとして扱い、トークンは再発行）
