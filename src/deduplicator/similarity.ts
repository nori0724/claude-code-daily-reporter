/**
 * 類似度判定モジュール
 * Layer 3重複排除のための類似度計算を提供
 */

import type { DedupThresholds } from '../types/index.js';

/**
 * 類似度判定結果
 */
export interface SimilarityResult {
  /** Jaccard類似度（0-1、1が完全一致） */
  jaccard: number;
  /** 正規化Levenshtein距離（0-1、0が完全一致） */
  levenshtein: number;
  /** 重複と判定されたか */
  isDuplicate: boolean;
  /** 判定に使用したカテゴリ */
  category: string;
}

/**
 * Jaccard類似度を計算する
 * @param text1 - 比較テキスト1
 * @param text2 - 比較テキスト2
 * @returns Jaccard類似度（0-1）
 */
export function calculateJaccardSimilarity(text1: string, text2: string): number {
  const tokens1 = tokenize(text1);
  const tokens2 = tokenize(text2);

  if (tokens1.size === 0 && tokens2.size === 0) {
    return 1; // 両方空の場合は完全一致
  }

  if (tokens1.size === 0 || tokens2.size === 0) {
    return 0; // 片方のみ空の場合は不一致
  }

  const intersection = new Set([...tokens1].filter((x) => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);

  return intersection.size / union.size;
}

/**
 * 正規化Levenshtein距離を計算する
 * @param text1 - 比較テキスト1
 * @param text2 - 比較テキスト2
 * @returns 正規化Levenshtein距離（0-1、0が完全一致）
 */
export function calculateLevenshteinDistance(text1: string, text2: string): number {
  const s1 = normalizeText(text1);
  const s2 = normalizeText(text2);

  if (s1 === s2) return 0;
  if (s1.length === 0) return 1;
  if (s2.length === 0) return 1;

  // Wagner-Fischer アルゴリズム
  const m = s1.length;
  const n = s2.length;

  // メモリ最適化: 2行のみ使用
  let prevRow: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let currRow: number[] = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      const deletion = prevRow[j] ?? 0;
      const insertion = currRow[j - 1] ?? 0;
      const substitution = prevRow[j - 1] ?? 0;
      currRow[j] = Math.min(
        deletion + 1,
        insertion + 1,
        substitution + cost
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  const distance = prevRow[n] ?? 0;
  const maxLength = Math.max(m, n);

  return distance / maxLength;
}

/**
 * テキストをトークン化する（Jaccard用）
 * @param text - トークン化するテキスト
 * @returns トークンのSet
 */
function tokenize(text: string): Set<string> {
  // 正規化
  const normalized = normalizeText(text);

  // 単語に分割（日本語は文字単位、英語は単語単位）
  const tokens = new Set<string>();

  // 英数字の単語を抽出
  const words = normalized.match(/[a-zA-Z0-9]+/g) || [];
  words.forEach((word) => tokens.add(word.toLowerCase()));

  // 日本語文字をbi-gramで抽出
  const japanese = normalized.replace(/[a-zA-Z0-9\s]/g, '');
  for (let i = 0; i < japanese.length - 1; i++) {
    tokens.add(japanese.substring(i, i + 2));
  }
  // 単独の日本語文字も追加（短い場合）
  if (japanese.length === 1) {
    tokens.add(japanese);
  }

  return tokens;
}

/**
 * テキストを正規化する
 * @param text - 正規化するテキスト
 * @returns 正規化されたテキスト
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    // 全角英数字を半角に変換
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0)
    )
    // 全角スペースを半角に
    .replace(/　/g, ' ')
    // 連続する空白を単一に
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * カテゴリを判定する
 * @param source - ソース識別子
 * @param url - URL
 * @returns カテゴリ名
 */
export function detectCategory(source: string, url: string): string {
  // ソースに基づくカテゴリ
  if (source.includes('arxiv')) return 'arxiv';
  if (source.includes('news') || source.includes('techcrunch')) return 'news';
  if (source.includes('blog') || source.includes('qiita') || source.includes('zenn')) {
    return 'blog';
  }

  // URLに基づくカテゴリ
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (hostname.includes('arxiv')) return 'arxiv';
    if (hostname.includes('techcrunch') || hostname.includes('wired') ||
        hostname.includes('theverge')) return 'news';
    if (hostname.includes('qiita') || hostname.includes('zenn') ||
        hostname.includes('dev.to') || hostname.includes('medium')) return 'blog';
  } catch {
    // URL解析に失敗した場合はデフォルト
  }

  return 'default';
}

/**
 * 類似度を判定する（Layer 3）
 * @param title1 - 比較タイトル1
 * @param title2 - 比較タイトル2
 * @param thresholds - しきい値設定
 * @param source - ソース識別子
 * @param url - URL
 * @returns 類似度判定結果
 */
export function checkSimilarity(
  title1: string,
  title2: string,
  thresholds: DedupThresholds,
  source: string = '',
  url: string = ''
): SimilarityResult {
  const jaccard = calculateJaccardSimilarity(title1, title2);
  const levenshtein = calculateLevenshteinDistance(title1, title2);

  const category = detectCategory(source, url);
  const threshold = thresholds.thresholds[category] ?? thresholds.thresholds['default'];
  const jaccardThreshold = threshold?.jaccard_gte ?? 0.7;
  const levenshteinThreshold = threshold?.levenshtein_lte ?? 0.3;

  // 重複判定: Jaccard >= しきい値 OR Levenshtein <= しきい値
  const isDuplicate = jaccard >= jaccardThreshold || levenshtein <= levenshteinThreshold;

  return {
    jaccard,
    levenshtein,
    isDuplicate,
    category,
  };
}

/**
 * Layer 2準重複判定（同一ドメイン/クロスドメイン）
 * @param title1 - 比較タイトル1
 * @param title2 - 比較タイトル2
 * @param isSameDomain - 同一ドメインかどうか
 * @param thresholds - しきい値設定
 * @param source - ソース識別子
 * @returns 重複かどうか
 */
export function checkLayer2Similarity(
  title1: string,
  title2: string,
  isSameDomain: boolean,
  thresholds: DedupThresholds,
  source: string = 'default'
): boolean {
  const jaccard = calculateJaccardSimilarity(title1, title2);

  const fallback = thresholds.layer2_fallback[source] ?? thresholds.layer2_fallback['default'];
  const sameDomainThreshold = fallback?.same_domain ?? 0.85;
  const crossDomainThreshold = fallback?.cross_domain ?? 0.9;
  const threshold = isSameDomain ? sameDomainThreshold : crossDomainThreshold;

  return jaccard >= threshold;
}

/**
 * タイトルのハッシュを計算する（高速な重複検出用）
 * 簡易的なハッシュで、完全一致の事前フィルタリングに使用
 * @param title - ハッシュ化するタイトル
 * @returns ハッシュ文字列
 */
export function calculateTitleHash(title: string): string {
  const normalized = normalizeText(title);
  // djb2ハッシュアルゴリズム
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    hash = hash & hash; // 32ビット整数に変換
  }
  return Math.abs(hash).toString(16);
}

/**
 * 複数の記事との類似度を一括チェックする
 * @param targetTitle - チェック対象のタイトル
 * @param existingTitles - 既存タイトルの配列
 * @param thresholds - しきい値設定
 * @param source - ソース識別子
 * @param url - URL
 * @returns 最も類似度の高い結果（重複が見つからない場合はnull）
 */
export function findMostSimilar(
  targetTitle: string,
  existingTitles: string[],
  thresholds: DedupThresholds,
  source: string = '',
  url: string = ''
): { title: string; result: SimilarityResult } | null {
  let mostSimilar: { title: string; result: SimilarityResult } | null = null;
  let highestScore = 0;

  for (const existingTitle of existingTitles) {
    const result = checkSimilarity(targetTitle, existingTitle, thresholds, source, url);

    if (result.isDuplicate) {
      // 最も類似度の高いものを保持
      const score = result.jaccard + (1 - result.levenshtein);
      if (score > highestScore) {
        highestScore = score;
        mostSimilar = { title: existingTitle, result };
      }
    }
  }

  return mostSimilar;
}
