/**
 * タグ正規化モジュール
 * tag-synonyms.jsonを使用してタグを正規化する
 */

import type { TagSynonyms } from '../types/index.js';

/**
 * タグ正規化クラス
 */
export class TagNormalizer {
  /** 同義語辞書（正規化タグ → 同義語リスト） */
  private synonyms: TagSynonyms;
  /** 逆引き辞書（同義語 → 正規化タグ） */
  private reverseMap: Map<string, string>;

  constructor(synonyms: TagSynonyms) {
    this.synonyms = synonyms;
    this.reverseMap = this.buildReverseMap(synonyms);
  }

  /**
   * 逆引き辞書を構築する
   */
  private buildReverseMap(synonyms: TagSynonyms): Map<string, string> {
    const map = new Map<string, string>();

    for (const [normalizedTag, synonymList] of Object.entries(synonyms)) {
      // 正規化タグ自体も登録（小文字で）
      map.set(normalizedTag.toLowerCase(), normalizedTag);

      // 各同義語を登録
      for (const synonym of synonymList) {
        map.set(synonym.toLowerCase(), normalizedTag);
      }
    }

    return map;
  }

  /**
   * タグを正規化する
   * @param tag - 正規化するタグ
   * @returns 正規化されたタグ（マッチしない場合はnull）
   */
  normalize(tag: string): string | null {
    const lowercaseTag = tag.toLowerCase().trim();
    return this.reverseMap.get(lowercaseTag) ?? null;
  }

  /**
   * テキストからタグを抽出・正規化する
   * @param text - テキスト（タイトルなど）
   * @returns 抽出された正規化タグの配列
   */
  extractTags(text: string): string[] {
    const foundTags = new Set<string>();
    const lowercaseText = text.toLowerCase();

    // すべての同義語をチェック
    for (const [synonym, normalizedTag] of this.reverseMap.entries()) {
      if (lowercaseText.includes(synonym)) {
        foundTags.add(normalizedTag);
      }
    }

    return Array.from(foundTags);
  }

  /**
   * 複数のテキストからタグを抽出・集計する
   * @param texts - テキストの配列
   * @returns タグと出現回数のMap
   */
  extractTagsFromMany(texts: string[]): Map<string, number> {
    const tagCounts = new Map<string, number>();

    for (const text of texts) {
      const tags = this.extractTags(text);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    return tagCounts;
  }

  /**
   * 正規化タグの一覧を取得する
   * @returns 正規化タグの配列
   */
  getAllNormalizedTags(): string[] {
    return Object.keys(this.synonyms);
  }

  /**
   * 特定の正規化タグの同義語を取得する
   * @param normalizedTag - 正規化タグ
   * @returns 同義語の配列（存在しない場合は空配列）
   */
  getSynonyms(normalizedTag: string): string[] {
    return this.synonyms[normalizedTag] ?? [];
  }

  /**
   * タグがマッチするかどうかをチェックする
   * @param text - チェックするテキスト
   * @param normalizedTag - チェックする正規化タグ
   * @returns マッチする場合true
   */
  matchesTag(text: string, normalizedTag: string): boolean {
    const lowercaseText = text.toLowerCase();

    // 正規化タグ自体をチェック
    if (lowercaseText.includes(normalizedTag.toLowerCase())) {
      return true;
    }

    // 同義語をチェック
    const synonyms = this.getSynonyms(normalizedTag);
    for (const synonym of synonyms) {
      if (lowercaseText.includes(synonym.toLowerCase())) {
        return true;
      }
    }

    return false;
  }
}

/**
 * TagNormalizerのファクトリ関数
 * @param synonyms - 同義語辞書
 * @returns TagNormalizerインスタンス
 */
export function createTagNormalizer(synonyms: TagSynonyms): TagNormalizer {
  return new TagNormalizer(synonyms);
}
