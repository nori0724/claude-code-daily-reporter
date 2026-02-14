# Claude Code Daily Reporter

> Claude Agent SDKを使った日次技術情報収集ツール

複数の情報ソース（ブログ、ニュース、Twitter）から自動で記事を収集・重複排除し、Markdownレポートを生成します。

## 特徴

- **12の情報ソース** - Claude Blog, OpenAI News, HackerNews, arXiv, Qiita, Zenn, X (Twitter) など
- **3層重複排除** - URL正規化 -> 履歴DB -> 類似度マッチング
- **Tier別信頼性管理** - Tier 1（高信頼）, Tier 2（標準）, Tier 3（best-effort）
- **Markdownレポート** - `output/daily-reports/` に日次レポートを保存

## クイックスタート

```bash
# 依存関係のインストール
npm install

# 設定ファイルのコピー
cp config/sources.example.json config/sources.json
cp config/queries.example.json config/queries.json
cp config/tag-synonyms.example.json config/tag-synonyms.json
cp config/dedup-thresholds.example.json config/dedup-thresholds.json
cp config/default.example.json config/default.json

# 実行（Claude Code認証が必要）
npm start
```

## CLIオプション

```bash
npm start -- --dry-run      # 実際の収集をスキップ（プロンプト生成のみ）
npm start -- --verbose      # 詳細出力
npm start -- --simple       # シンプルレポート形式
npm start -- --date 2024-02-14  # 日付を指定
```

## ドキュメント

- **[AGENTS.md](AGENTS.md)** - AIエージェント・開発者向け詳細ガイド
- **[docs/CRON_SETUP.md](docs/CRON_SETUP.md)** - cron設定ガイド
- **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** - 開発背景・技術選定・工夫点

## 必要環境

- Node.js 18+
- Claude Code認証済み（`claude` コマンドで認証）
