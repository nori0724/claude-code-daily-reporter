/**
 * タイトル分析モジュール
 * タイトルから興味領域を抽出し、関連度を計算する
 */

import type { QueriesConfig, QueryGroup } from '../types/index.js';
import { TagNormalizer } from './tag-normalizer.js';

/**
 * タイトル分析結果
 */
export interface TitleAnalysisResult {
  /** 抽出されたタグ */
  tags: string[];
  /** マッチしたクエリグループID */
  matchedGroups: string[];
  /** 関連度スコア（0-1） */
  relevanceScore: number;
}

/**
 * 興味分析結果
 */
export interface InterestAnalysis {
  /** クエリグループ別のマッチ数 */
  groupCounts: Map<string, number>;
  /** タグ別の出現数 */
  tagCounts: Map<string, number>;
  /** 重み付きスコア（クエリグループID → スコア） */
  weightedScores: Map<string, number>;
}

/**
 * タイトル分析クラス
 */
export class TitleAnalyzer {
  private tagNormalizer: TagNormalizer;
  private queryGroups: QueryGroup[];

  constructor(tagNormalizer: TagNormalizer, queryGroups: QueryGroup[]) {
    this.tagNormalizer = tagNormalizer;
    this.queryGroups = queryGroups;
  }

  /**
   * 単一タイトルを分析する
   * @param title - 分析するタイトル
   * @returns 分析結果
   */
  analyzeTitle(title: string): TitleAnalysisResult {
    const tags = this.tagNormalizer.extractTags(title);
    const matchedGroups = this.findMatchingGroups(title);

    // 関連度スコアを計算（マッチしたグループの重みの合計を正規化）
    const totalWeight = matchedGroups.reduce((sum, groupId) => {
      const group = this.queryGroups.find((g) => g.id === groupId);
      return sum + (group?.weight ?? 1.0);
    }, 0);

    // 最大重みで正規化
    const maxPossibleWeight = this.queryGroups.reduce(
      (sum, g) => sum + g.weight,
      0
    );
    const relevanceScore = maxPossibleWeight > 0 ? totalWeight / maxPossibleWeight : 0;

    return {
      tags,
      matchedGroups,
      relevanceScore: Math.min(relevanceScore, 1.0),
    };
  }

  /**
   * 複数タイトルを分析し、興味を集計する
   * @param titles - 分析するタイトルの配列
   * @returns 興味分析結果
   */
  analyzeInterests(titles: string[]): InterestAnalysis {
    const groupCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    const weightedScores = new Map<string, number>();

    for (const title of titles) {
      const result = this.analyzeTitle(title);

      // タグをカウント
      for (const tag of result.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }

      // グループをカウント
      for (const groupId of result.matchedGroups) {
        groupCounts.set(groupId, (groupCounts.get(groupId) ?? 0) + 1);

        // 重み付きスコアを累積
        const group = this.queryGroups.find((g) => g.id === groupId);
        const weight = group?.weight ?? 1.0;
        weightedScores.set(
          groupId,
          (weightedScores.get(groupId) ?? 0) + weight
        );
      }
    }

    return {
      groupCounts,
      tagCounts,
      weightedScores,
    };
  }

  /**
   * タイトルにマッチするクエリグループを検索する
   * @param title - 検索するタイトル
   * @returns マッチしたグループIDの配列
   */
  private findMatchingGroups(title: string): string[] {
    const lowercaseTitle = title.toLowerCase();
    const matchedGroups: string[] = [];

    for (const group of this.queryGroups) {
      for (const keyword of group.keywords) {
        if (lowercaseTitle.includes(keyword.toLowerCase())) {
          matchedGroups.push(group.id);
          break; // 1つマッチしたら次のグループへ
        }
      }
    }

    return matchedGroups;
  }

  /**
   * 関連度でソートされたクエリグループを取得する
   * @param titles - 分析に使用するタイトル配列
   * @returns 関連度順のクエリグループIDと重みの配列
   */
  getRankedGroups(titles: string[]): Array<{ groupId: string; score: number; count: number }> {
    const analysis = this.analyzeInterests(titles);

    const ranked: Array<{ groupId: string; score: number; count: number }> = [];

    for (const [groupId, score] of analysis.weightedScores) {
      ranked.push({
        groupId,
        score,
        count: analysis.groupCounts.get(groupId) ?? 0,
      });
    }

    // スコア降順でソート
    ranked.sort((a, b) => b.score - a.score);

    return ranked;
  }

  /**
   * タイトルが関心領域にマッチするかどうかを判定する
   * @param title - 判定するタイトル
   * @returns マッチする場合true
   */
  isRelevant(title: string): boolean {
    const result = this.analyzeTitle(title);
    return result.matchedGroups.length > 0 || result.tags.length > 0;
  }

  /**
   * 関連度スコアを計算する（0-1）
   * @param title - 計算するタイトル
   * @returns 関連度スコア
   */
  calculateRelevance(title: string): number {
    return this.analyzeTitle(title).relevanceScore;
  }
}

/**
 * TitleAnalyzerのファクトリ関数
 * @param tagNormalizer - タグ正規化インスタンス
 * @param queryGroups - クエリグループ配列
 * @returns TitleAnalyzerインスタンス
 */
export function createTitleAnalyzer(
  tagNormalizer: TagNormalizer,
  queryGroups: QueryGroup[]
): TitleAnalyzer {
  return new TitleAnalyzer(tagNormalizer, queryGroups);
}
