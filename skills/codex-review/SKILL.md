---
name: codex-review
description: |
  Codexを使ってコードやドキュメントをレビュー。
  以下の場合に使用: (1) コードレビューを依頼したい (2) 実装計画のレビュー (3) ドキュメントの整合性チェック (4) 改善提案が欲しい
  トリガー例: "codexでレビューして", "planをレビュー", "このコードをチェック"
---

# Codexレビュー

Codexを使って指定されたコードやドキュメントをレビューします。

## 使い方

```
/codex-review <レビュー対象とプロンプト>
```

## 例

- `/codex-review src/index.ts のコードをレビュー`
- `/codex-review planをレビューしてください`
- `/codex-review docs/DEVELOPMENT.md の整合性をチェック`
- `/codex-review 検証結果の解釈と改善案を提案`

## 実行内容

以下のコマンドを実行してCodexにレビューを依頼:

```bash
codex exec --full-auto --sandbox read-only --skip-git-repo-check \
  --cd "$PWD" \
  "$ARGUMENTS 確認や質問は不要です。具体的な修正案まで出力してください。"
```

## planファイルのレビュー

計画をレビューする場合、planファイルのパスを指定:

```bash
# planファイルの場所を確認
ls -la ~/.claude/plans/

# 特定のplanをレビュー
codex exec --full-auto --sandbox read-only \
  "~/.claude/plans/<plan-file>.md をレビューして改善点を指摘してください"
```

## オプション

- `--full-auto`: 確認なしで実行
- `--sandbox read-only`: 読み取り専用（安全）
- `--skip-git-repo-check`: gitリポジトリチェックをスキップ
