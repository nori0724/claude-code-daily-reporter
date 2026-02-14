/**
 * 重複排除モジュール
 * 3層重複排除の統合処理を提供
 */

import type {
  RawArticle,
  FilteredArticle,
  HistoryEntry,
  DedupThresholds,
  DateConfidence,
  DateSource,
  FreshnessPriority,
  DateMethodConfig,
} from '../types/index.js';
import { normalizeUrl, extractDomain, isSameDomain } from './url-normalizer.js';
import { HistoryStore, type HistoryStoreConfig } from './history-store.js';
import {
  checkSimilarity,
  checkLayer2Similarity,
  calculateTitleHash,
  findMostSimilar,
} from './similarity.js';
import {
  parseDateMultiLayer,
  checkFreshness,
  calculateWindowStart,
  parseDateByMethod,
} from './date-parser.js';

// Re-export for convenience
export * from './url-normalizer.js';
export * from './history-store.js';
export * from './similarity.js';
export * from './date-parser.js';

/**
 * 重複排除オプション
 */
export interface DeduplicatorOptions {
  /** 履歴ストア設定 */
  historyStoreConfig: HistoryStoreConfig;
  /** 重複判定しきい値 */
  thresholds: DedupThresholds;
  /** URL正規化オプション */
  urlNormalization: {
    removeParams: string[];
    normalizeTrailingSlash: boolean;
    lowercaseHost: boolean;
  };
  /** 前回成功時刻（Freshness判定用） */
  lastSuccessAt?: string | null;
}

/**
 * 重複排除結果
 */
export interface DeduplicationResult {
  /** フィルタ済み記事 */
  articles: FilteredArticle[];
  /** 統計情報 */
  stats: {
    totalInput: number;
    afterUrlDedup: number;
    afterHistoryDedup: number;
    afterSimilarityDedup: number;
    freshArticles: number;
  };
}

/**
 * 重複排除クラス
 */
export class Deduplicator {
  private historyStore: HistoryStore;
  private thresholds: DedupThresholds;
  private urlNormalization: DeduplicatorOptions['urlNormalization'];
  private lastSuccessAt: string | null;

  constructor(options: DeduplicatorOptions) {
    this.historyStore = new HistoryStore(options.historyStoreConfig);
    this.thresholds = options.thresholds;
    this.urlNormalization = options.urlNormalization;
    this.lastSuccessAt = options.lastSuccessAt ?? null;
  }

  /**
   * 記事の重複排除を実行する
   * @param articles - 生の記事配列
   * @param dateMethod - 各ソースの日付取得方法（ソースID → DateMethodConfig）
   * @returns 重複排除結果
   */
  async deduplicate(
    articles: RawArticle[],
    dateMethod?: Map<string, DateMethodConfig>
  ): Promise<DeduplicationResult> {
    const stats = {
      totalInput: articles.length,
      afterUrlDedup: 0,
      afterHistoryDedup: 0,
      afterSimilarityDedup: 0,
      freshArticles: 0,
    };

    // Layer 1: URL正規化 + 重複排除
    const urlDeduped = this.deduplicateByUrl(articles);
    stats.afterUrlDedup = urlDeduped.length;

    // Layer 1 continued: 履歴DB照合
    const historyDeduped = this.deduplicateByHistory(urlDeduped);
    stats.afterHistoryDedup = historyDeduped.length;

    // Layer 2 & 3: 類似度判定
    const similarityDeduped = this.deduplicateBySimilarity(historyDeduped);
    stats.afterSimilarityDedup = similarityDeduped.length;

    // Freshness判定（dateMethodマップを渡す）
    const windowStart = calculateWindowStart(this.lastSuccessAt);
    const filtered = this.filterByFreshness(similarityDeduped, windowStart, dateMethod);
    stats.freshArticles = filtered.filter((a) => a.isNew).length;

    // 履歴DBに追加
    await this.updateHistory(filtered);

    return {
      articles: filtered,
      stats,
    };
  }

  /**
   * Layer 1: URL正規化による重複排除
   */
  private deduplicateByUrl(articles: RawArticle[]): Array<RawArticle & { normalizedUrl: string }> {
    const seen = new Set<string>();
    const result: Array<RawArticle & { normalizedUrl: string }> = [];

    for (const article of articles) {
      try {
        const normalizedUrl = normalizeUrl(article.url, this.urlNormalization);
        if (!seen.has(normalizedUrl)) {
          seen.add(normalizedUrl);
          result.push({ ...article, normalizedUrl });
        }
      } catch {
        // URL正規化に失敗した場合は元のURLを使用
        if (!seen.has(article.url)) {
          seen.add(article.url);
          result.push({ ...article, normalizedUrl: article.url });
        }
      }
    }

    return result;
  }

  /**
   * Layer 1 continued: 履歴DBによる重複排除
   */
  private deduplicateByHistory(
    articles: Array<RawArticle & { normalizedUrl: string }>
  ): Array<RawArticle & { normalizedUrl: string; historyEntry?: HistoryEntry }> {
    const urls = articles.map((a) => a.normalizedUrl);
    const existingUrls = this.historyStore.findExistingUrls(urls);

    return articles
      .filter((article) => !existingUrls.has(article.normalizedUrl))
      .map((article) => ({ ...article, historyEntry: undefined }));
  }

  /**
   * Layer 2 & 3: 類似度による重複排除
   */
  private deduplicateBySimilarity(
    articles: Array<RawArticle & { normalizedUrl: string }>
  ): Array<RawArticle & { normalizedUrl: string; similarityScore?: number }> {
    const result: Array<RawArticle & { normalizedUrl: string; similarityScore?: number }> = [];
    const processedTitles: string[] = [];

    for (const article of articles) {
      // Layer 2: 同一セッション内の重複チェック
      let isDuplicate = false;
      for (const existingTitle of processedTitles) {
        const sameDomain = result.some(
          (a) =>
            a.title === existingTitle &&
            isSameDomain(a.url, article.url)
        );

        if (checkLayer2Similarity(
          article.title,
          existingTitle,
          sameDomain,
          this.thresholds,
          article.source
        )) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        // Layer 3: あいまい一致チェック
        const similar = findMostSimilar(
          article.title,
          processedTitles,
          this.thresholds,
          article.source,
          article.url
        );

        if (!similar) {
          result.push({
            ...article,
            similarityScore: undefined,
          });
          processedTitles.push(article.title);
        }
      }
    }

    return result;
  }

  /**
   * Freshness判定とFilteredArticle変換
   */
  private filterByFreshness(
    articles: Array<RawArticle & { normalizedUrl: string; similarityScore?: number }>,
    windowStart: Date,
    dateMethodMap?: Map<string, DateMethodConfig>
  ): FilteredArticle[] {
    const now = new Date();

    const filteredArticles = articles.map((article) => {
      // ソースに対応するdateMethodConfigを取得
      const methodConfig = dateMethodMap?.get(article.source);

      // 日付をパース
      // 1. RawArticleに既にpublishedAtがあればそれを使用（Layer 1: 厳密判定）
      // 2. dateMethodConfigがあればそれを使用
      // 3. なければ3層パース
      // 注: dateResultの型はDateParseResult互換（date: string | null）
      let dateResult: { date: string | null; confidence: DateConfidence; source: DateSource };

      if (article.publishedAt) {
        // Layer 1: RawArticleから取得したpublishedAtを使用
        const parsed = new Date(article.publishedAt);
        dateResult = isNaN(parsed.getTime())
          ? { date: null, confidence: 'unknown', source: 'first_seen_at' as DateSource }
          : { date: parsed.toISOString(), confidence: 'high', source: 'published_at' as DateSource };
      } else if (methodConfig) {
        // dateMethodConfigを使用（selector/patternを渡す）
        // dateMetaContentがあれば、メタ情報として渡す
        dateResult = parseDateByMethod(methodConfig.type, {
          url: article.url,
          metaContent: article.dateMetaContent,
          searchResultText: article.dateMetaContent,
          dateSelector: methodConfig.selector,
          datePattern: methodConfig.pattern,
          referenceDate: now,
        });
      } else {
        // 3層パース
        dateResult = parseDateMultiLayer({
          publishedAt: undefined,
          url: article.url,
          relativeTimeText: undefined,
          referenceDate: now,
        });
      }

      // Freshness判定（ソースに応じて適切なフィールドをstring型で渡す）
      const freshnessResult = checkFreshness({
        publishedAt: dateResult.source === 'published_at' ? dateResult.date : null,
        urlDate: dateResult.source === 'url_date' ? dateResult.date : null,
        relativeTimeParsed: dateResult.source === 'relative_time' ? dateResult.date : null,
        windowStart,
      });

      const filtered: FilteredArticle = {
        ...article,
        isNew: freshnessResult.isFresh,
        publishedAt: dateResult.date ?? undefined,
        dateConfidence: dateResult.confidence,
        dateSource: dateResult.source,
        urlDate: dateResult.source === 'url_date' ? dateResult.date ?? undefined : undefined,
        relativeTimeParsed: dateResult.source === 'relative_time' ? dateResult.date ?? undefined : undefined,
        freshnessPriority: freshnessResult.priority,
      };

      return filtered;
    });

    // 古い記事を除外（isNew: falseの記事を除外）
    // ただし、日付が不明な記事（confidence: 'unknown'）は残す
    return filteredArticles.filter(
      (article) => article.isNew || article.dateConfidence === 'unknown'
    );
  }

  /**
   * 履歴DBを更新する
   */
  private async updateHistory(articles: FilteredArticle[]): Promise<void> {
    const now = new Date().toISOString();
    const entries = articles.map((article) => ({
      url: article.url,
      normalizedUrl: article.normalizedUrl,
      title: article.title,
      firstSeenAt: now,
      lastSeenAt: now,
      publishedAt: article.publishedAt,
      dateConfidence: article.dateConfidence,
      source: article.source,
      titleHash: calculateTitleHash(article.title),
    }));

    this.historyStore.bulkUpsert(entries);
  }

  /**
   * 古い履歴をクリーンアップする
   */
  cleanup(): number {
    return this.historyStore.cleanup();
  }

  /**
   * 履歴ストアの統計を取得する
   */
  getHistoryStats() {
    return this.historyStore.getStats();
  }

  /**
   * リソースを解放する
   */
  close(): void {
    this.historyStore.close();
  }
}

/**
 * Deduplicatorのファクトリ関数
 */
export function createDeduplicator(options: DeduplicatorOptions): Deduplicator {
  return new Deduplicator(options);
}
