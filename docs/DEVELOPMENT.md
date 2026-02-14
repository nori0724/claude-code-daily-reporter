# 開発背景・技術選定

> このプロジェクトはClaude Codeを使ったバイブコーディングで作成されました

## 背景・モチベーション

### 課題
日々の技術トレンドをキャッチアップするため、毎朝30分〜1時間かけて以下のような作業を行っていました：

- TechCrunch、HackerNewsの確認
- Qiita/Zennのトレンドチェック
- arXivの新着論文確認
- X (Twitter) での技術系アカウントのチェック

この情報収集を自動化し、毎朝5分で済むようにしたいというモチベーションで開発を開始しました。

### 既存の参考実装の課題
参考にした既存実装には「**同じ記事が連日レポートに出てしまう**」という課題がありました。WebSearchツールには日付指定機能がないため、検索結果に古い記事が混入してしまうのです。

この課題を解決するため、本プロジェクトでは**3層重複排除パイプライン**を設計しました。

---

## アーキテクチャ設計

### 2-Stage Pipeline

```
Stage 1: 情報収集          Stage 2: 整理・出力
┌─────────────────┐      ┌─────────────────┐
│  WebSearch      │      │  3層重複排除    │
│  WebFetch       │  ──▶ │  日付フィルタ   │  ──▶  Markdownレポート
│  (12ソース)     │      │  (カテゴリ化*)  │
└─────────────────┘      └─────────────────┘
* カテゴリ化は将来実装予定。現在は簡易レポート形式で出力。
```

**Stage 1（収集）** と **Stage 2（整理）** を分離することで：
- 収集と整理の関心を分離
- 収集失敗時のリトライが容易
- 将来的なソース追加が容易

### 3層重複排除

「同じ記事が連日出る」問題を解決するため、3層の重複排除を実装：

| レイヤー | 判定方法 | 目的 |
|---------|---------|------|
| Layer 1 | URL完全一致 | 同一URLの即時除外 |
| Layer 2 | タイトル+ドメイン+日付 | 転載記事の検出 |
| Layer 3 | Jaccard/Levenshtein類似度 | 類似タイトルの検出 |

**SQLite履歴DB**で過去90日の記事を追跡し、初回検出日時（`first_seen_at`）を記録することで「いつ初めて見た記事か」を判定可能にしました。

### Tier別ソース管理

情報ソースの信頼性に応じて3段階に分類：

| Tier | 特徴 | リトライ | 例 |
|------|------|---------|-----|
| Tier 1 | 高信頼・公式 | 3回 | Anthropic Blog, Claude Blog, HackerNews |
| Tier 2 | 標準 | 1回 | TechCrunch, arXiv, Qiita |
| Tier 3 | Best-effort | 0回 | X (Twitter) |

※ ソースごとにWebFetch（直接取得）とWebSearch（検索経由）を使い分けています。

Tier 3（Twitter）は取得できなくてもレポート生成は継続。部分的な失敗を許容する設計です。

---

## 技術選定

### Claude Agent SDK

**選定理由：**
- WebSearch/WebFetchツールを直接利用可能
- Claude Code認証を自動的に使用（APIキー不要）
- LLMによる柔軟な情報抽出

```typescript
// SDK経由でWebFetchを実行
const result = await query({
  prompt: buildWebFetchPrompt(source),
  options: {
    allowedTools: ['WebFetch'],
    permissionMode: 'bypassPermissions',
  },
});
```

### TypeScript + Vitest

**選定理由：**
- 型安全性による開発効率向上
- Vitestの高速なテスト実行（200以上のテストが数秒で完了）
- スナップショットテストによるMarkdown出力の検証

### SQLite (better-sqlite3)

**選定理由：**
- ファイルベースで外部依存なし
- 同期APIで扱いやすい
- 90日保持のデータ量なら十分な性能

---

## 工夫点

### 1. 日付判定の多層化

WebSearchツールは日付指定ができないため、複数の方法で日付を推定：

```typescript
// 優先順位
1. メタタグ（article:published_time）
2. URLパス（/2024/02/14/）
3. 検索結果の相対時刻（"3時間前"）
4. 初回検出日時（first_seen_at）
```

### 2. 設定駆動の設計

すべての挙動をJSONで制御可能に：
- `sources.json` - ソース定義
- `dedup-thresholds.json` - カテゴリ別の類似度しきい値
- `queries.json` - 検索クエリと重み

新しいソースの追加がコード変更なしで可能です。

### 3. 多重起動防止（macOS対応）

macOSには`flock`がないため、`mkdir`ベースのロック機構を実装：

```bash
LOCK_DIR="data/run.lock.d"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "Another instance is running"
    exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT
```

### 4. 部分失敗の許容

Tier 3ソース（Twitter）の失敗は致命的エラーとせず、取得できた分でレポートを生成。終了コード0で正常終了とし、cron監視との相性を維持しました。

### 5. ファクトリパターンの採用

各モジュールは`createXxx()`関数をエクスポート：

```typescript
// 良い例
export function createCollector(options: CollectorOptions): Collector {
  return new Collector(options);
}

// 直接的なクラスエクスポートは避ける
```

テスト時のモック化が容易になり、依存性注入もシンプルに。

---

## バイブコーディングでの開発プロセス

このプロジェクトはClaude Codeとの対話的な開発で作成されました：

1. **計画フェーズ**: 要件とアーキテクチャをマークダウンで詳細に記述
2. **実装フェーズ**: モジュールごとに実装とテストを並行
3. **統合フェーズ**: 統合テストで全体の動作を確認
4. **運用準備**: cron設定、ドキュメント整備

特に「計画フェーズ」で詳細なプランを作成したことで、実装時の手戻りが最小限に抑えられました。

### Claude Code Codexによる自動レビュー

開発中、**Claude Code Codex**（`codex exec`）を活用した自動コードレビューを実施しました：

```bash
# Codexによる自動レビュー実行
codex exec "このコードベースをレビューして、問題点や改善点を指摘してください"
```

**活用例：**
- 実装とドキュメントの不一致検出（例：「Stage 2のカテゴリ化」が未実装なのにドキュメントに記載）
- 固定値の陳腐化リスク指摘（例：「265テスト」という具体的数値）
- 設定ファイルと説明文の整合性チェック

人間のレビューでは見落としがちな細かい不整合を、AIが網羅的にチェックしてくれるため、ドキュメントの品質向上に貢献しました。

---

## 今後の拡張予定

- [ ] Stage 2のAIカテゴリ化（現在は簡易レポートのみ）
- [ ] Brave Search MCPによる日付指定検索
- [ ] Slack通知連携
- [ ] KPI監視ダッシュボード
