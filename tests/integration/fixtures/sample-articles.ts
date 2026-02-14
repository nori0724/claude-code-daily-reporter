/**
 * 統合テスト用フィクスチャ
 * 決定的なテストデータを提供
 */

import type {
  RawArticle,
  FilteredArticle,
  CollectionResult,
  DeduplicationResult,
  SourceConfig,
  DateConfidence,
  FreshnessPriority,
} from '../../../src/types/index.js';

/**
 * RawArticle を作成するファクトリ関数
 */
export function createRawArticle(overrides: Partial<RawArticle> = {}): RawArticle {
  return {
    url: `https://example.com/article/${Date.now()}`,
    title: 'Test Article Title',
    summary: 'This is a test article summary.',
    source: 'test_source',
    collectedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * FilteredArticle を作成するファクトリ関数
 */
export function createFilteredArticle(
  overrides: Partial<FilteredArticle> = {}
): FilteredArticle {
  const base = createRawArticle(overrides);
  return {
    ...base,
    normalizedUrl: overrides.normalizedUrl ?? base.url.toLowerCase(),
    isNew: overrides.isNew ?? true,
    dateConfidence: overrides.dateConfidence ?? ('medium' as DateConfidence),
    freshnessPriority: overrides.freshnessPriority ?? ('normal' as FreshnessPriority),
    ...overrides,
  };
}

/**
 * スナップショットテスト用の固定記事データ
 */
export const FIXTURE_ARTICLES: RawArticle[] = [
  {
    url: 'https://techcrunch.com/2024/01/15/ai-breakthrough',
    title: 'Major AI Breakthrough Announced',
    summary: 'Researchers announce significant advances in AI capabilities.',
    source: 'techcrunch',
    collectedAt: '2024-01-15T10:00:00Z',
    publishedAt: '2024-01-15T08:00:00Z',
  },
  {
    url: 'https://techcrunch.com/2024/01/15/ai-breakthrough?utm_source=twitter',
    title: 'Major AI Breakthrough Announced', // UTMパラメータ付きの重複
    summary: 'Researchers announce significant advances in AI capabilities.',
    source: 'techcrunch',
    collectedAt: '2024-01-15T10:01:00Z',
    publishedAt: '2024-01-15T08:00:00Z',
  },
  {
    url: 'https://arxiv.org/abs/2401.12345',
    title: 'New AI Research Paper',
    summary: 'A groundbreaking paper on machine learning.',
    source: 'arxiv',
    collectedAt: '2024-01-15T10:05:00Z',
  },
  {
    url: 'https://qiita.com/user/items/abc123',
    title: 'AI開発入門',
    summary: 'AIアプリケーション開発の基礎を解説します。',
    source: 'qiita',
    collectedAt: '2024-01-15T10:10:00Z',
    publishedAt: '2024-01-14T12:00:00Z',
  },
  {
    url: 'https://qiita.com/user/items/def456',
    title: 'AI開発入門 - 続編', // 類似タイトル
    summary: 'AIアプリケーション開発の応用編です。',
    source: 'qiita',
    collectedAt: '2024-01-15T10:15:00Z',
    publishedAt: '2024-01-14T14:00:00Z',
  },
];

/**
 * 履歴DBテスト用の既存エントリ
 */
export const FIXTURE_HISTORY_ENTRIES = [
  {
    url: 'https://example.com/old-article',
    normalizedUrl: 'https://example.com/old-article',
    title: 'Old Article Already in History',
    firstSeenAt: '2024-01-10T00:00:00Z',
    lastSeenAt: '2024-01-10T00:00:00Z',
    source: 'test_source',
    dateConfidence: 'high' as DateConfidence,
  },
];

/**
 * 収集結果フィクスチャ
 */
export const FIXTURE_COLLECTION_RESULT: CollectionResult = {
  articles: FIXTURE_ARTICLES,
  errors: [],
  sourcesStatus: {
    techcrunch: 'success',
    arxiv: 'success',
    qiita: 'success',
  },
  stats: {
    totalSources: 3,
    successfulSources: 3,
    partialSources: 0,
    failedSources: 0,
    totalArticles: FIXTURE_ARTICLES.length,
    executionTimeMs: 5000,
  },
};

/**
 * フィルタリング済み記事フィクスチャ（スナップショット用）
 */
export const FIXTURE_FILTERED_ARTICLES: FilteredArticle[] = [
  {
    ...FIXTURE_ARTICLES[0]!,
    normalizedUrl: 'https://techcrunch.com/2024/01/15/ai-breakthrough',
    isNew: true,
    dateConfidence: 'high',
    freshnessPriority: 'high',
  },
  {
    ...FIXTURE_ARTICLES[2]!,
    normalizedUrl: 'https://arxiv.org/abs/2401.12345',
    isNew: true,
    dateConfidence: 'medium',
    freshnessPriority: 'normal',
  },
  {
    ...FIXTURE_ARTICLES[3]!,
    normalizedUrl: 'https://qiita.com/user/items/abc123',
    isNew: true,
    dateConfidence: 'high',
    freshnessPriority: 'normal',
  },
];

/**
 * 重複排除結果フィクスチャ
 */
export const FIXTURE_DEDUP_RESULT: DeduplicationResult = {
  articles: FIXTURE_FILTERED_ARTICLES,
  stats: {
    totalInput: 5,
    afterUrlDedup: 4,
    afterHistoryDedup: 4,
    afterSimilarityDedup: 3,
    freshArticles: 3,
  },
};

/**
 * ソース設定フィクスチャ
 */
export const FIXTURE_SOURCES: SourceConfig[] = [
  {
    id: 'techcrunch',
    name: 'TechCrunch',
    tier: 2,
    enabled: true,
    collectMethod: 'WebSearch',
    query: 'site:techcrunch.com',
    dateMethod: 'url_parse',
    datePattern: '/(\\d{4})/(\\d{2})/(\\d{2})/',
    maxArticles: 10,
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    tier: 2,
    enabled: true,
    collectMethod: 'WebSearch',
    query: 'site:arxiv.org',
    dateMethod: 'search_result',
    maxArticles: 10,
  },
  {
    id: 'qiita',
    name: 'Qiita',
    tier: 2,
    enabled: true,
    collectMethod: 'WebFetch',
    url: 'https://qiita.com/',
    dateMethod: 'html_meta',
    dateSelector: "meta[property='article:published_time']",
    maxArticles: 8,
  },
  {
    id: 'claude_blog',
    name: 'Claude Blog',
    tier: 1,
    enabled: true,
    collectMethod: 'WebFetch',
    url: 'https://claude.com/ja-jp/blog',
    dateMethod: 'html_meta',
    dateSelector: "meta[property='article:published_time']",
    maxArticles: 10,
  },
];

/**
 * 固定日付（スナップショットテスト用）
 */
export const FIXED_DATE = new Date('2024-01-15T12:00:00Z');
