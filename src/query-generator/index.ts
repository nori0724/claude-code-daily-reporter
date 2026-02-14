/**
 * クエリ生成モジュール
 * 検索クエリの自動生成と重み付けを行う
 */

import type { QueriesConfig, QueryGroup, TagSynonyms } from '../types/index.js';
import { TagNormalizer, createTagNormalizer } from './tag-normalizer.js';
import { TitleAnalyzer, createTitleAnalyzer, type InterestAnalysis } from './title-analyzer.js';

// Re-export
export * from './tag-normalizer.js';
export * from './title-analyzer.js';

/**
 * 生成されたクエリ
 */
export interface GeneratedQuery {
  /** クエリ文字列 */
  query: string;
  /** 元のクエリグループID */
  groupId: string;
  /** グループ名 */
  groupName: string;
  /** 基本重み */
  baseWeight: number;
  /** 計算された最終重み */
  finalWeight: number;
  /** 関連キーワード */
  keywords: string[];
}

/**
 * クエリ生成結果
 */
export interface QueryGenerationResult {
  /** 生成されたクエリ（重み順） */
  queries: GeneratedQuery[];
  /** 統計情報 */
  stats: {
    totalQueries: number;
    selectedQueries: number;
    topGroups: string[];
  };
}

/**
 * 重み計算オプション
 */
export interface WeightCalculationOptions {
  /** 直近の出現頻度に基づく補正係数の範囲 */
  recencyFactorRange: { min: number; max: number };
  /** 全期間の出現頻度に基づく補正係数の範囲 */
  frequencyFactorRange: { min: number; max: number };
  /** 分析に使用するタイトル数 */
  recentTitlesCount: number;
}

/** デフォルトの重み計算オプション */
const DEFAULT_WEIGHT_OPTIONS: WeightCalculationOptions = {
  recencyFactorRange: { min: 0.5, max: 1.5 },
  frequencyFactorRange: { min: 0.8, max: 1.2 },
  recentTitlesCount: 100,
};

/**
 * クエリ生成クラス
 */
export class QueryGenerator {
  private tagNormalizer: TagNormalizer;
  private titleAnalyzer: TitleAnalyzer;
  private config: QueriesConfig;
  private weightOptions: WeightCalculationOptions;

  constructor(
    synonyms: TagSynonyms,
    config: QueriesConfig,
    weightOptions: WeightCalculationOptions = DEFAULT_WEIGHT_OPTIONS
  ) {
    this.tagNormalizer = createTagNormalizer(synonyms);
    this.titleAnalyzer = createTitleAnalyzer(this.tagNormalizer, config.queryGroups);
    this.config = config;
    this.weightOptions = weightOptions;
  }

  /**
   * クエリを生成する
   * @param recentTitles - 直近のタイトル配列（重み計算に使用）
   * @param allTitles - 全期間のタイトル配列（重み計算に使用）
   * @returns クエリ生成結果
   */
  generate(recentTitles: string[] = [], allTitles: string[] = []): QueryGenerationResult {
    // 興味分析
    const recentAnalysis = this.titleAnalyzer.analyzeInterests(recentTitles);
    const allAnalysis = this.titleAnalyzer.analyzeInterests(allTitles);

    // クエリを生成
    const queries = this.generateQueries(recentAnalysis, allAnalysis);

    // 重み順にソート
    queries.sort((a, b) => b.finalWeight - a.finalWeight);

    // 上位Nクエリを選択
    const selectedQueries = queries.slice(0, this.config.selection.topN);

    // 統計情報
    const topGroups = selectedQueries
      .slice(0, 5)
      .map((q) => q.groupName);

    return {
      queries: selectedQueries,
      stats: {
        totalQueries: queries.length,
        selectedQueries: selectedQueries.length,
        topGroups,
      },
    };
  }

  /**
   * クエリを生成する（内部メソッド）
   */
  private generateQueries(
    recentAnalysis: InterestAnalysis,
    allAnalysis: InterestAnalysis
  ): GeneratedQuery[] {
    const queries: GeneratedQuery[] = [];

    for (const group of this.config.queryGroups) {
      // 基本重み
      const baseWeight = group.weight;

      // 直近の出現頻度に基づく補正
      const recentCount = recentAnalysis.groupCounts.get(group.id) ?? 0;
      const recentValues = Array.from(recentAnalysis.groupCounts.values());
      const maxRecentCount = recentValues.length > 0 ? Math.max(...recentValues) : 1;
      const recencyFactor = this.calculateFactor(
        recentCount / maxRecentCount,
        this.weightOptions.recencyFactorRange
      );

      // 全期間の出現頻度に基づく補正
      const allCount = allAnalysis.groupCounts.get(group.id) ?? 0;
      const allValues = Array.from(allAnalysis.groupCounts.values());
      const maxAllCount = allValues.length > 0 ? Math.max(...allValues) : 1;
      const frequencyFactor = this.calculateFactor(
        allCount / maxAllCount,
        this.weightOptions.frequencyFactorRange
      );

      // 最終重み = 基本重み × 直近係数 × 頻度係数
      const finalWeight = baseWeight * recencyFactor * frequencyFactor;

      // 各キーワードをクエリとして生成
      for (const keyword of group.keywords) {
        queries.push({
          query: keyword,
          groupId: group.id,
          groupName: group.name,
          baseWeight,
          finalWeight,
          keywords: group.keywords,
        });
      }

      // 組み合わせクエリを生成（設定で有効な場合）
      if (this.config.combinedQueries.enabled) {
        const combinedQueries = this.generateCombinedQueries(
          group,
          finalWeight
        );
        queries.push(...combinedQueries);
      }
    }

    return queries;
  }

  /**
   * 組み合わせクエリを生成する
   */
  private generateCombinedQueries(
    group: QueryGroup,
    weight: number
  ): GeneratedQuery[] {
    const queries: GeneratedQuery[] = [];
    const maxCombinations = this.config.combinedQueries.maxCombinations;
    const keywords = group.keywords.slice(0, maxCombinations * 2); // 組み合わせに使用するキーワード数を制限

    // 2つのキーワードの組み合わせ
    for (let i = 0; i < keywords.length && queries.length < maxCombinations; i++) {
      for (let j = i + 1; j < keywords.length && queries.length < maxCombinations; j++) {
        const kw1 = keywords[i];
        const kw2 = keywords[j];
        if (kw1 && kw2) {
          queries.push({
            query: `${kw1} ${kw2}`,
            groupId: group.id,
            groupName: group.name,
            baseWeight: group.weight,
            finalWeight: weight * 0.9, // 組み合わせは少し重みを下げる
            keywords: [kw1, kw2],
          });
        }
      }
    }

    return queries;
  }

  /**
   * 補正係数を計算する
   */
  private calculateFactor(
    ratio: number,
    range: { min: number; max: number }
  ): number {
    // ratio (0-1) を range.min-range.max にマッピング
    return range.min + ratio * (range.max - range.min);
  }

  /**
   * ソースに割り当てるクエリを取得する
   * @param sourceId - ソースID
   * @param queries - 全クエリ
   * @returns 割り当てられたクエリ
   */
  getQueriesForSource(
    sourceId: string,
    queries: GeneratedQuery[]
  ): GeneratedQuery[] {
    const maxPerSource = this.config.selection.maxPerSource;

    // 各グループから最大1つずつ、合計maxPerSource個まで
    const selectedGroups = new Set<string>();
    const result: GeneratedQuery[] = [];

    for (const query of queries) {
      if (result.length >= maxPerSource) break;

      // 同じグループからは1つだけ
      if (!selectedGroups.has(query.groupId)) {
        selectedGroups.add(query.groupId);
        result.push(query);
      }
    }

    return result;
  }

  /**
   * 日付制限付きクエリを構築する
   * @param query - 元のクエリ
   * @returns 日付制限付きクエリ文字列
   */
  buildDateRestrictedQuery(query: GeneratedQuery): string {
    // 日付制限はgetDateRestrictionDays()で取得し、検索エンジン固有のパラメータとして使用
    // クエリ文字列自体は変更しない
    return query.query;
  }

  /**
   * 日付制限日数を取得する
   */
  getDateRestrictionDays(): number | null {
    if (!this.config.dateRestriction.enabled) {
      return null;
    }
    return this.config.dateRestriction.withinDays;
  }

  /**
   * タグ正規化インスタンスを取得する
   */
  getTagNormalizer(): TagNormalizer {
    return this.tagNormalizer;
  }

  /**
   * タイトル分析インスタンスを取得する
   */
  getTitleAnalyzer(): TitleAnalyzer {
    return this.titleAnalyzer;
  }
}

/**
 * QueryGeneratorのファクトリ関数
 */
export function createQueryGenerator(
  synonyms: TagSynonyms,
  config: QueriesConfig,
  weightOptions?: WeightCalculationOptions
): QueryGenerator {
  return new QueryGenerator(synonyms, config, weightOptions);
}
