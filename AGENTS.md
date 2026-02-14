# AGENTS.md

このファイルはAIエージェント（Claude Code等）がこのリポジトリで作業する際のガイドです。

## プロジェクト概要

Claude Agent SDKを使った日次技術情報収集ツール。2-Stageパイプラインで実装：
1. **収集** - Claude Agent SDKのWebSearch/WebFetchツールで記事を収集
2. **重複排除** - 3層重複排除（URL正規化 → 履歴DB → 類似度マッチング）

## コマンド

```bash
npm run build       # TypeScriptコンパイル
npm start           # 収集実行 (tsx src/index.ts)
npm run dev         # ウォッチモード
npm test            # Vitestでテスト実行
npm run test:watch  # テストウォッチモード
npm run typecheck   # 型チェック
npm run lint        # ESLint
npm run format      # Prettierフォーマット
```

**CLIオプション:** `--dry-run`（収集スキップ）, `--verbose`, `--simple`（簡易レポート）, `--date YYYY-MM-DD`

## アーキテクチャ

```
src/
├── index.ts           # メインエントリー、2-Stageオーケストレーター
├── types/index.ts     # 全TypeScriptインターフェース（単一の情報源）
├── config/loader.ts   # 設定ファイル読み込み
├── collector/         # Stage 1: Claude Agent SDK用タスク準備
│   ├── index.ts       # 収集メインロジック
│   ├── prompts.ts     # 収集用プロンプト
│   └── sdk-executor.ts # Claude Agent SDK統合
├── query-generator/   # 設定+履歴からの動的クエリ生成
├── deduplicator/      # Stage 2: 3層重複排除パイプライン
│   ├── index.ts       # 重複排除オーケストレーター
│   ├── url-normalizer.ts   # Layer 1: URL正規化
│   ├── history-store.ts    # Layer 2: SQLite履歴（90日保持）
│   ├── similarity.ts       # Layer 3: Jaccard + Levenshtein
│   └── date-parser.ts      # 複数形式の日付抽出
├── organizer/         # AIカテゴリ化プロンプト
└── output/            # Markdownレポート生成

config/                # JSON設定ファイル（*.example.jsonをテンプレートとして使用）
├── sources.example.json       # ソース定義（tier, method, dateMethod）
├── queries.example.json       # 検索クエリグループと重み
├── tag-synonyms.example.json  # タグ同義語マッピング
├── dedup-thresholds.example.json  # 類似度しきい値
└── default.example.json       # アプリケーション設定
```

## 主要パターン

- **ファクトリ関数**: モジュールは`createXxx()`関数をエクスポート（クラス直接ではなく）
- **型駆動**: 全インターフェースは`src/types/index.ts`に集約
- **設定駆動**: 挙動は`config/*.json`で制御
- **3層重複排除**: URL完全一致 → 履歴DB検索 → あいまい類似度

## 設定

1. 設定テンプレートをコピー: `cp config/*.example.json config/*.json`（`.example`を除去）
2. **新しいソース追加**: `config/sources.json`にtier (1-3), collectMethod, dateMethodを設定
3. **重複判定調整**: `config/dedup-thresholds.json`のしきい値を変更
4. **クエリグループ追加**: `config/queries.json`に追加、必要に応じて`config/tag-synonyms.json`も更新

## よくあるタスク

### 新しい情報ソースを追加

`config/sources.json`を編集：
```json
{
  "id": "new_source",
  "name": "新しいソース名",
  "tier": 2,
  "enabled": true,
  "collectMethod": "WebFetch",  // または "WebSearch"
  "url": "https://example.com/",
  "dateMethod": "html_meta",
  "dateSelector": "meta[property='article:published_time']",
  "maxArticles": 10
}
```

### 重複判定しきい値の調整

`config/dedup-thresholds.json`でソースカテゴリ別の類似度しきい値を調整。

### テスト実行

```bash
npm test                    # 全テスト
npm test -- --coverage      # カバレッジ付き
npx vitest run --update     # スナップショット更新
```

## cron実行

`scripts/run-daily.sh`による日次実行：
- ロックファイルで多重起動防止
- `logs/run_status.jsonl`にログ出力
- `output/daily-reports/daily-report-YYYY-MM-DD.md`にレポート保存

詳細は[docs/CRON_SETUP.md](docs/CRON_SETUP.md)を参照。

## 情報ソース（Tierシステム）

| Tier | 説明 | リトライ | ソース例 |
|------|------|---------|---------|
| 1 | 高信頼 | 3回 | Claude Blog, OpenAI News, Anthropic Blog, HackerNews |
| 2 | 標準 | 1回 | TechCrunch, arXiv, Qiita, Zenn, Cursor Blog, Cognition Blog |
| 3 | Best-effort | 0回 | X (Twitter) |
