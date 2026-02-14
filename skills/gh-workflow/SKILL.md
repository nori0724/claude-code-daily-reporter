---
name: gh-workflow
description: |
  GitHub CLIを使ったIssue・PR操作のワークフロー。
  以下の場合に使用: (1) Issueの作成・確認 (2) PRの作成・レビュー (3) GitHub操作全般
  トリガー例: "issue作って", "PR作成", "PRをレビュー", "issueを確認"
---

# GitHub Workflow

GitHub CLI (`gh`) を使ったIssue・PR操作ガイド。

## Issue操作

### Issue一覧

```bash
gh issue list                    # オープンなissue一覧
gh issue list --state all        # 全issue
gh issue list --label "bug"      # ラベルでフィルタ
```

### Issue作成

```bash
gh issue create --title "タイトル" --body "本文"
gh issue create --title "タイトル" --body "本文" --label "enhancement"
```

### Issue確認・編集

```bash
gh issue view 123                # Issue詳細
gh issue comment 123 --body "コメント"
gh issue close 123               # クローズ
```

## PR操作

### PR一覧

```bash
gh pr list                       # オープンなPR一覧
gh pr list --state merged        # マージ済み
```

### PR作成

```bash
# 対話形式
gh pr create

# 直接作成
gh pr create --title "タイトル" --body "$(cat <<'EOF'
## Summary
- 変更内容

## Test plan
- [ ] テスト項目
EOF
)"
```

### PR確認・レビュー

```bash
gh pr view 123                   # PR詳細
gh pr diff 123                   # 差分確認
gh pr checks 123                 # CI状態
gh pr review 123 --approve       # 承認
gh pr review 123 --comment -b "コメント"
gh pr merge 123                  # マージ
```

## リポジトリ操作

```bash
gh repo create <name> --public --source=. --push  # リポジトリ作成&プッシュ
gh repo view                     # 現在のリポジトリ情報
gh repo clone <owner/repo>       # クローン
```

## よく使うパターン

### 現在のブランチでPR作成

```bash
git push -u origin HEAD && gh pr create --fill
```

### Issue起票からブランチ作成

```bash
gh issue develop 123 --checkout  # Issue用ブランチ作成
```

### PR作成時のテンプレート

```bash
gh pr create --title "feat: 機能追加" --body "$(cat <<'EOF'
## Summary
- 機能の概要

## Changes
- 変更点1
- 変更点2

## Test plan
- [ ] 単体テスト
- [ ] 統合テスト
EOF
)"
```
