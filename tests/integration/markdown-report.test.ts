/**
 * 統合テスト: Markdownレポート出力
 * スナップショットテストでレポートフォーマットの一貫性を検証
 */

import { describe, it, expect } from 'vitest';
import {
  generateSimpleReport,
  generateDailyReport,
  generateReportFilename,
  type ReportOptions,
} from '../../src/output/markdown.js';
import type { CategorizedArticle } from '../../src/organizer/prompts.js';
import {
  FIXTURE_FILTERED_ARTICLES,
  FIXTURE_COLLECTION_RESULT,
  FIXTURE_DEDUP_RESULT,
  FIXTURE_SOURCES,
  FIXED_DATE,
  createFilteredArticle,
} from './fixtures/sample-articles.js';

describe('Markdownレポート出力 統合テスト', () => {
  describe('generateSimpleReport', () => {
    it('正常なレポートを生成する（スナップショット）', () => {
      const report = generateSimpleReport(
        FIXTURE_FILTERED_ARTICLES,
        FIXTURE_COLLECTION_RESULT,
        FIXTURE_DEDUP_RESULT,
        FIXED_DATE,
        FIXTURE_SOURCES
      );

      expect(report).toMatchSnapshot();
    });

    it('空の記事配列を正しく処理する', () => {
      const emptyCollectionResult = {
        ...FIXTURE_COLLECTION_RESULT,
        articles: [],
        stats: {
          ...FIXTURE_COLLECTION_RESULT.stats,
          totalArticles: 0,
        },
      };

      const emptyDedupResult = {
        articles: [],
        stats: {
          totalInput: 0,
          afterUrlDedup: 0,
          afterHistoryDedup: 0,
          afterSimilarityDedup: 0,
          freshArticles: 0,
        },
      };

      const report = generateSimpleReport(
        [],
        emptyCollectionResult,
        emptyDedupResult,
        FIXED_DATE,
        FIXTURE_SOURCES
      );

      expect(report).toMatchSnapshot();
      expect(report).toContain('Total: 0 collected');
      expect(report).toContain('New Articles | 0');
    });

    it('Tier別ステータスを正しく表示する', () => {
      const report = generateSimpleReport(
        FIXTURE_FILTERED_ARTICLES,
        FIXTURE_COLLECTION_RESULT,
        FIXTURE_DEDUP_RESULT,
        FIXED_DATE,
        FIXTURE_SOURCES
      );

      // Tier1: 1 source (claude_blog) - all success
      expect(report).toContain('Tier1');
      // Tier2: 3 sources (techcrunch, arxiv, qiita) - all success
      expect(report).toContain('Tier2');
    });

    it('ソース情報なしでも動作する', () => {
      const report = generateSimpleReport(
        FIXTURE_FILTERED_ARTICLES,
        FIXTURE_COLLECTION_RESULT,
        FIXTURE_DEDUP_RESULT,
        FIXED_DATE
        // sources を省略
      );

      expect(report).toBeDefined();
      expect(report).toContain('Daily Tech Report');
      expect(report).not.toContain('Sources:');
    });

    it('新着記事がない場合のレポート', () => {
      const oldArticles = FIXTURE_FILTERED_ARTICLES.map((a) => ({
        ...a,
        isNew: false,
      }));

      const report = generateSimpleReport(
        oldArticles,
        FIXTURE_COLLECTION_RESULT,
        FIXTURE_DEDUP_RESULT,
        FIXED_DATE,
        FIXTURE_SOURCES
      );

      expect(report).toMatchSnapshot();
      // 新着セクションが空
      expect(report).not.toContain('## New Articles');
    });
  });

  describe('generateDailyReport', () => {
    it('カテゴリ化された記事のレポートを生成する（スナップショット）', () => {
      const categorizedArticles = new Map<string, CategorizedArticle[]>();

      // LLM/AI カテゴリ
      categorizedArticles.set('llm', [
        {
          categoryId: 'llm',
          categoryName: 'LLM/エージェント',
          article: FIXTURE_FILTERED_ARTICLES[0]!,
          relevanceScore: 5,
          tags: ['LLM', 'AI', 'ブレークスルー'],
          aiSummary: 'AI分野での重要なブレークスルー',
        },
      ]);

      // 論文 カテゴリ
      categorizedArticles.set('research', [
        {
          categoryId: 'research',
          categoryName: '研究・論文',
          article: FIXTURE_FILTERED_ARTICLES[1]!,
          relevanceScore: 4,
          tags: ['機械学習', '論文'],
          aiSummary: '機械学習に関する最新研究',
        },
      ]);

      // 開発 カテゴリ
      categorizedArticles.set('dev', [
        {
          categoryId: 'dev',
          categoryName: '開発・実装',
          article: FIXTURE_FILTERED_ARTICLES[2]!,
          relevanceScore: 3,
          tags: ['入門', '開発'],
          aiSummary: '開発入門ガイド',
        },
      ]);

      const options: ReportOptions = {
        date: FIXED_DATE,
        collectionResult: FIXTURE_COLLECTION_RESULT,
        deduplicationResult: FIXTURE_DEDUP_RESULT,
        categorizedArticles,
        categoryOrder: ['llm', 'research', 'dev'],
        executionTimeMs: 5000,
      };

      const report = generateDailyReport(options);

      expect(report).toMatchSnapshot();
      expect(report).toContain('LLM/エージェント');
      expect(report).toContain('研究・論文');
      expect(report).toContain('開発・実装');
    });

    it('トップ記事ハイライトを含むレポートを生成する', () => {
      const categorizedArticles = new Map<string, CategorizedArticle[]>();

      const topArticle: CategorizedArticle = {
        categoryId: 'llm',
        categoryName: 'LLM/エージェント',
        article: FIXTURE_FILTERED_ARTICLES[0]!,
        relevanceScore: 5,
        tags: ['LLM', 'AI'],
        aiSummary: '今日最も注目のAI記事',
      };

      categorizedArticles.set('llm', [topArticle]);

      const options: ReportOptions = {
        date: FIXED_DATE,
        collectionResult: FIXTURE_COLLECTION_RESULT,
        deduplicationResult: FIXTURE_DEDUP_RESULT,
        categorizedArticles,
        categoryOrder: ['llm'],
        topArticles: [
          {
            article: topArticle,
            rank: 1,
            reason: '今日最も重要なAI関連ニュース',
          },
        ],
        executionTimeMs: 3000,
      };

      const report = generateDailyReport(options);

      expect(report).toMatchSnapshot();
      expect(report).toContain("Today's Highlights");
      expect(report).toContain('今日最も重要なAI関連ニュース');
    });

    it('未分類記事を正しく処理する', () => {
      const categorizedArticles = new Map<string, CategorizedArticle[]>();

      // 未分類カテゴリ
      categorizedArticles.set('other', [
        {
          categoryId: 'other',
          categoryName: 'その他',
          article: FIXTURE_FILTERED_ARTICLES[1]!,
          relevanceScore: 2,
          tags: [],
          aiSummary: '未分類の記事',
        },
      ]);

      const options: ReportOptions = {
        date: FIXED_DATE,
        collectionResult: FIXTURE_COLLECTION_RESULT,
        deduplicationResult: FIXTURE_DEDUP_RESULT,
        categorizedArticles,
        categoryOrder: [], // カテゴリ順序は空
        executionTimeMs: 2000,
      };

      const report = generateDailyReport(options);

      expect(report).toContain('その他');
    });

    it('空のカテゴリを含むレポートを生成する', () => {
      const categorizedArticles = new Map<string, CategorizedArticle[]>();

      // 空のカテゴリ
      categorizedArticles.set('llm', []);
      categorizedArticles.set('research', [
        {
          categoryId: 'research',
          categoryName: '研究・論文',
          article: FIXTURE_FILTERED_ARTICLES[1]!,
          relevanceScore: 4,
          tags: ['論文'],
          aiSummary: '重要な研究論文',
        },
      ]);

      const options: ReportOptions = {
        date: FIXED_DATE,
        collectionResult: FIXTURE_COLLECTION_RESULT,
        deduplicationResult: FIXTURE_DEDUP_RESULT,
        categorizedArticles,
        categoryOrder: ['llm', 'research'],
        executionTimeMs: 2500,
      };

      const report = generateDailyReport(options);

      // 空のカテゴリはスキップされる
      expect(report).not.toContain('LLM/エージェント');
      expect(report).toContain('研究・論文');
    });
  });

  describe('generateReportFilename', () => {
    it('正しいファイル名を生成する', () => {
      const filename = generateReportFilename(FIXED_DATE);
      expect(filename).toBe('daily-report-2024-01-15.md');
    });

    it('異なる日付で正しいファイル名を生成する', () => {
      // JSTで2024-12-31になる日付を使用
      const date = new Date('2024-12-31T10:00:00+09:00');
      const filename = generateReportFilename(date);
      expect(filename).toBe('daily-report-2024-12-31.md');
    });

    it('年初の日付で正しいファイル名を生成する', () => {
      // JSTで2025-01-01になる日付を使用
      const date = new Date('2025-01-01T10:00:00+09:00');
      const filename = generateReportFilename(date);
      expect(filename).toBe('daily-report-2025-01-01.md');
    });
  });

  describe('メタデータセクション', () => {
    it('実行時間を正しくフォーマットする（秒）', () => {
      const categorizedArticles = new Map<string, CategorizedArticle[]>();

      const options: ReportOptions = {
        date: FIXED_DATE,
        collectionResult: FIXTURE_COLLECTION_RESULT,
        deduplicationResult: FIXTURE_DEDUP_RESULT,
        categorizedArticles,
        categoryOrder: [],
        executionTimeMs: 45000, // 45秒
      };

      const report = generateDailyReport(options);

      expect(report).toContain('45s');
    });

    it('実行時間を正しくフォーマットする（分と秒）', () => {
      const categorizedArticles = new Map<string, CategorizedArticle[]>();

      const options: ReportOptions = {
        date: FIXED_DATE,
        collectionResult: FIXTURE_COLLECTION_RESULT,
        deduplicationResult: FIXTURE_DEDUP_RESULT,
        categorizedArticles,
        categoryOrder: [],
        executionTimeMs: 272000, // 4分32秒
      };

      const report = generateDailyReport(options);

      expect(report).toContain('4m 32s');
    });

    it('重複排除統計を正しく表示する', () => {
      const categorizedArticles = new Map<string, CategorizedArticle[]>();

      const options: ReportOptions = {
        date: FIXED_DATE,
        collectionResult: FIXTURE_COLLECTION_RESULT,
        deduplicationResult: FIXTURE_DEDUP_RESULT,
        categorizedArticles,
        categoryOrder: [],
        executionTimeMs: 5000,
      };

      const report = generateDailyReport(options);

      expect(report).toContain('After URL Dedup | 4');
      expect(report).toContain('After History Dedup | 4');
      expect(report).toContain('After Similarity Dedup | 3');
      expect(report).toContain('Fresh Articles | 3');
    });
  });

  describe('エッジケース', () => {
    it('特殊文字を含むタイトルを正しく処理する', () => {
      const articleWithSpecialChars = createFilteredArticle({
        title: 'Article with [brackets] and (parens) & <tags>',
        url: 'https://example.com/special',
        source: 'test',
      });

      const report = generateSimpleReport(
        [articleWithSpecialChars],
        FIXTURE_COLLECTION_RESULT,
        FIXTURE_DEDUP_RESULT,
        FIXED_DATE
      );

      expect(report).toContain('[brackets]');
      expect(report).toContain('(parens)');
      expect(report).toContain('& <tags>');
    });

    it('長いサマリーを含む記事を正しく処理する', () => {
      const longSummary = 'A'.repeat(1000);
      const articleWithLongSummary = createFilteredArticle({
        title: 'Article with long summary',
        url: 'https://example.com/long',
        summary: longSummary,
        source: 'test',
      });

      const report = generateSimpleReport(
        [articleWithLongSummary],
        FIXTURE_COLLECTION_RESULT,
        FIXTURE_DEDUP_RESULT,
        FIXED_DATE
      );

      expect(report).toContain(longSummary);
    });

    it('日本語タイトルを正しく処理する', () => {
      const japaneseArticle = createFilteredArticle({
        title: '日本語タイトルのテスト記事',
        url: 'https://example.com/japanese',
        summary: 'これは日本語のサマリーです。',
        source: 'test',
      });

      const report = generateSimpleReport(
        [japaneseArticle],
        FIXTURE_COLLECTION_RESULT,
        FIXTURE_DEDUP_RESULT,
        FIXED_DATE
      );

      expect(report).toContain('日本語タイトルのテスト記事');
      expect(report).toContain('これは日本語のサマリーです。');
    });
  });
});
