/**
 * 統合テスト: 重複排除フロー
 * URL正規化 → 履歴DB → 類似度判定 の3層パイプラインをテスト
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createDeduplicator, type DeduplicatorOptions } from '../../src/deduplicator/index.js';
import { FIXTURE_ARTICLES, createRawArticle } from './fixtures/sample-articles.js';
import type { DedupThresholds } from '../../src/types/index.js';

describe('重複排除フロー統合テスト', () => {
  let testDbPath: string;
  let tmpDir: string;
  let deduplicator: ReturnType<typeof createDeduplicator>;

  const testThresholds: DedupThresholds = {
    metric_definitions: {
      jaccard: 'Word overlap ratio',
      levenshtein: 'Edit distance ratio',
    },
    thresholds: {
      techcrunch: { jaccard_gte: 0.7, levenshtein_lte: 0.3 },
      qiita: { jaccard_gte: 0.8, levenshtein_lte: 0.2 },
      default: { jaccard_gte: 0.75, levenshtein_lte: 0.25 },
    },
    layer2_fallback: {
      default: { same_domain: 0.85, cross_domain: 0.95 },
    },
  };

  beforeEach(() => {
    // テスト用一時ディレクトリを作成
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedup-test-'));
    testDbPath = path.join(tmpDir, 'test-history.db');

    const options: DeduplicatorOptions = {
      historyStoreConfig: {
        path: testDbPath,
        retentionDays: 90,
      },
      thresholds: testThresholds,
      urlNormalization: {
        removeParams: ['utm_source', 'utm_medium', 'utm_campaign', 'ref'],
        normalizeTrailingSlash: true,
        lowercaseHost: true,
      },
      lastSuccessAt: null,
    };

    deduplicator = createDeduplicator(options);
  });

  afterEach(() => {
    deduplicator.close();

    // テスト用ファイルをクリーンアップ
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Layer 1: URL正規化', () => {
    it('UTMパラメータ付きの重複記事を除外する', async () => {
      const result = await deduplicator.deduplicate(FIXTURE_ARTICLES);

      // FIXTURE_ARTICLESには utm_source 付きの重複が1件あるので、1件減るはず
      expect(result.stats.afterUrlDedup).toBe(FIXTURE_ARTICLES.length - 1);
    });

    it('末尾スラッシュの違いを正規化する', async () => {
      const articles = [
        createRawArticle({ url: 'https://example.com/path/', title: 'Article 1' }),
        createRawArticle({ url: 'https://example.com/path', title: 'Article 2 (same URL)' }),
      ];

      const result = await deduplicator.deduplicate(articles);
      expect(result.stats.afterUrlDedup).toBe(1);
    });

    it('ホスト名を小文字に正規化する', async () => {
      const articles = [
        createRawArticle({ url: 'https://EXAMPLE.COM/path', title: 'Article 1' }),
        createRawArticle({ url: 'https://example.com/path', title: 'Article 2' }),
      ];

      const result = await deduplicator.deduplicate(articles);
      expect(result.stats.afterUrlDedup).toBe(1);
    });
  });

  describe('Layer 1.5: 履歴DB', () => {
    it('履歴に存在する記事を除外する', async () => {
      // 新しい日付で記事を作成（freshnessフィルタを通過するため）
      const freshArticle = createRawArticle({
        url: 'https://example.com/fresh-article',
        title: 'Fresh Article',
        publishedAt: new Date().toISOString(), // 現在時刻で新鮮な記事
      });

      // 最初の記事を履歴に登録
      const firstBatch = [freshArticle];
      await deduplicator.deduplicate(firstBatch);

      // 履歴に追加されたことを確認
      const statsAfterFirst = deduplicator.getHistoryStats();
      expect(statsAfterFirst.totalEntries).toBe(1);

      // 最初のdeduplicatorを閉じてDBをリリース
      deduplicator.close();

      // 新しいdeduplicatorインスタンスで同じDBを使用（同じ正規化設定を使用）
      const newDeduplicator = createDeduplicator({
        historyStoreConfig: { path: testDbPath, retentionDays: 90 },
        thresholds: testThresholds,
        urlNormalization: {
          removeParams: ['utm_source', 'utm_medium', 'utm_campaign', 'ref'],
          normalizeTrailingSlash: true,
          lowercaseHost: true,
        },
        lastSuccessAt: null,
      });

      // 履歴が引き継がれていることを確認
      const statsInNewDedup = newDeduplicator.getHistoryStats();
      expect(statsInNewDedup.totalEntries).toBe(1);

      // 同じ記事を含むバッチを処理
      const secondBatch = [
        freshArticle, // 既に履歴にある
        createRawArticle({
          url: 'https://new-site.com/new-article',
          title: 'New Article',
          publishedAt: new Date().toISOString(),
        }),
      ];

      const result = await newDeduplicator.deduplicate(secondBatch);

      // 履歴にある記事は除外される（2件入力 → URL重複排除後2件 → 履歴重複排除後1件）
      expect(result.stats.afterHistoryDedup).toBe(1);

      // テストの後始末のため、deduplicatorを再設定
      deduplicator = newDeduplicator;
    });

    it('クリーンアップで古いエントリを削除する', async () => {
      // 記事を履歴に登録
      await deduplicator.deduplicate([
        createRawArticle({ url: 'https://example.com/article1' }),
      ]);

      const statsBeforeCleanup = deduplicator.getHistoryStats();
      expect(statsBeforeCleanup.totalEntries).toBe(1);

      // クリーンアップを実行（保持期間内なので削除されない）
      const cleaned = deduplicator.cleanup();
      expect(cleaned).toBe(0);
    });
  });

  describe('Layer 2 & 3: 類似度判定', () => {
    it('同一セッション内の類似タイトルを除外する', async () => {
      const articles = [
        createRawArticle({
          url: 'https://a.com/1',
          title: 'Claude AI Release Notes',
          source: 'test',
        }),
        createRawArticle({
          url: 'https://b.com/2',
          title: 'Claude AI Release Notes Update', // 類似タイトル
          source: 'test',
        }),
        createRawArticle({
          url: 'https://c.com/3',
          title: 'Completely Different Article',
          source: 'test',
        }),
      ];

      const result = await deduplicator.deduplicate(articles);

      // 類似タイトルの1件が除外される
      expect(result.stats.afterSimilarityDedup).toBeLessThan(result.stats.afterHistoryDedup);
    });

    it('異なるドメイン間の転載記事を検出する', async () => {
      const articles = [
        createRawArticle({
          url: 'https://original.com/article',
          title: 'Breaking: New AI Model Released',
          source: 'original',
        }),
        createRawArticle({
          url: 'https://aggregator.com/news/12345',
          title: 'Breaking: New AI Model Released', // 完全一致の転載
          source: 'aggregator',
        }),
      ];

      const result = await deduplicator.deduplicate(articles);
      expect(result.stats.afterSimilarityDedup).toBe(1);
    });
  });

  describe('フルパイプライン', () => {
    it('全レイヤーを通じて正しく処理する', async () => {
      const result = await deduplicator.deduplicate(FIXTURE_ARTICLES);

      // 統計の一貫性を確認
      expect(result.stats.totalInput).toBe(FIXTURE_ARTICLES.length);
      expect(result.stats.afterUrlDedup).toBeLessThanOrEqual(result.stats.totalInput);
      expect(result.stats.afterHistoryDedup).toBeLessThanOrEqual(result.stats.afterUrlDedup);
      expect(result.stats.afterSimilarityDedup).toBeLessThanOrEqual(result.stats.afterHistoryDedup);

      // 出力記事の必須フィールドを確認
      for (const article of result.articles) {
        expect(article.normalizedUrl).toBeDefined();
        expect(article.isNew).toBeDefined();
        expect(article.dateConfidence).toBeDefined();
        expect(article.freshnessPriority).toBeDefined();
      }
    });

    it('空の入力を正しく処理する', async () => {
      const result = await deduplicator.deduplicate([]);

      expect(result.stats.totalInput).toBe(0);
      expect(result.stats.afterUrlDedup).toBe(0);
      expect(result.articles).toHaveLength(0);
    });

    it('単一記事を正しく処理する', async () => {
      const article = createRawArticle({
        url: 'https://example.com/single',
        title: 'Single Article',
      });

      const result = await deduplicator.deduplicate([article]);

      expect(result.stats.totalInput).toBe(1);
      expect(result.articles).toHaveLength(1);
      expect(result.articles[0]?.normalizedUrl).toBe('https://example.com/single');
    });
  });

  describe('Freshness判定', () => {
    it('公開日がある記事に高い優先度を設定する', async () => {
      const article = createRawArticle({
        url: 'https://example.com/with-date',
        title: 'Article with Date',
        publishedAt: new Date().toISOString(),
      });

      const result = await deduplicator.deduplicate([article]);
      const filtered = result.articles[0];

      expect(filtered).toBeDefined();
      expect(filtered?.dateConfidence).toBe('high');
    });

    it('公開日がない記事に低い優先度を設定する', async () => {
      const article = createRawArticle({
        url: 'https://example.com/no-date',
        title: 'Article without Date',
        publishedAt: undefined,
      });

      const result = await deduplicator.deduplicate([article]);
      const filtered = result.articles[0];

      expect(filtered).toBeDefined();
      // 日付がない場合は unknown or medium
      expect(['unknown', 'medium']).toContain(filtered?.dateConfidence);
    });
  });
});
