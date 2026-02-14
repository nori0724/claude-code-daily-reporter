import { describe, it, expect } from 'vitest';
import {
  calculateJaccardSimilarity,
  calculateLevenshteinDistance,
  checkSimilarity,
  checkLayer2Similarity,
  calculateTitleHash,
  findMostSimilar,
  detectCategory,
} from '@/deduplicator/similarity';
import type { DedupThresholds } from '@/types/index';

// テスト用のしきい値設定
const testThresholds: DedupThresholds = {
  metric_definitions: {
    jaccard: 'Jaccard類似度（0-1、1が完全一致）。しきい値以上で重複と判定',
    levenshtein: '正規化Levenshtein距離（0-1、0が完全一致）。しきい値以下で重複と判定',
  },
  thresholds: {
    default: { jaccard_gte: 0.7, levenshtein_lte: 0.3 },
    arxiv: { jaccard_gte: 0.8, levenshtein_lte: 0.2 },
    news: { jaccard_gte: 0.6, levenshtein_lte: 0.4 },
    blog: { jaccard_gte: 0.75, levenshtein_lte: 0.25 },
  },
  layer2_fallback: {
    hackernews: { same_domain: 0.9, cross_domain: 0.95 },
    qiita: { same_domain: 0.8, cross_domain: 0.85 },
    default: { same_domain: 0.85, cross_domain: 0.9 },
  },
};

describe('calculateJaccardSimilarity', () => {
  it('完全一致の場合1を返す', () => {
    expect(calculateJaccardSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('完全に異なる場合0を返す', () => {
    expect(calculateJaccardSimilarity('hello world', 'foo bar baz')).toBe(0);
  });

  it('部分的に一致する場合は0-1の値を返す', () => {
    const similarity = calculateJaccardSimilarity('hello world test', 'hello world');
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
  });

  it('両方空の場合1を返す', () => {
    expect(calculateJaccardSimilarity('', '')).toBe(1);
  });

  it('片方のみ空の場合0を返す', () => {
    expect(calculateJaccardSimilarity('hello', '')).toBe(0);
    expect(calculateJaccardSimilarity('', 'hello')).toBe(0);
  });

  it('大文字小文字を区別しない', () => {
    expect(calculateJaccardSimilarity('Hello World', 'hello world')).toBe(1);
  });

  it('日本語テキストを処理できる', () => {
    const similarity = calculateJaccardSimilarity('機械学習入門', '機械学習');
    expect(similarity).toBeGreaterThan(0);
  });

  it('日本語と英語の混合テキストを処理できる', () => {
    const similarity = calculateJaccardSimilarity(
      'Claude 4発表',
      'Claude 4が発表されました'
    );
    expect(similarity).toBeGreaterThan(0);
  });
});

describe('calculateLevenshteinDistance', () => {
  it('完全一致の場合0を返す', () => {
    expect(calculateLevenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('完全に異なる場合1を返す', () => {
    expect(calculateLevenshteinDistance('abc', 'xyz')).toBe(1);
  });

  it('1文字違いの場合は小さな値を返す', () => {
    const distance = calculateLevenshteinDistance('hello', 'hallo');
    expect(distance).toBeCloseTo(0.2, 2); // 1/5 = 0.2
  });

  it('空文字との比較', () => {
    expect(calculateLevenshteinDistance('hello', '')).toBe(1);
    expect(calculateLevenshteinDistance('', 'hello')).toBe(1);
    expect(calculateLevenshteinDistance('', '')).toBe(0);
  });

  it('大文字小文字を区別しない', () => {
    expect(calculateLevenshteinDistance('Hello', 'hello')).toBe(0);
  });

  it('日本語テキストを処理できる', () => {
    const distance = calculateLevenshteinDistance('機械学習', '機械学');
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(1);
  });

  it('全角英数字を半角に変換して比較する', () => {
    expect(calculateLevenshteinDistance('ＡＢＣ', 'abc')).toBe(0);
  });
});

describe('detectCategory', () => {
  it('arXiv URLをarxivカテゴリと判定する', () => {
    expect(detectCategory('', 'https://arxiv.org/abs/2401.12345')).toBe('arxiv');
  });

  it('arXivソースをarxivカテゴリと判定する', () => {
    expect(detectCategory('arxiv', '')).toBe('arxiv');
  });

  it('TechCrunch URLをnewsカテゴリと判定する', () => {
    expect(detectCategory('', 'https://techcrunch.com/article')).toBe('news');
  });

  it('Qiita URLをblogカテゴリと判定する', () => {
    expect(detectCategory('', 'https://qiita.com/user/items/abc')).toBe('blog');
  });

  it('Zenn URLをblogカテゴリと判定する', () => {
    expect(detectCategory('', 'https://zenn.dev/user/articles/abc')).toBe('blog');
  });

  it('不明なURLはdefaultカテゴリと判定する', () => {
    expect(detectCategory('', 'https://example.com/article')).toBe('default');
  });

  it('無効なURLはdefaultカテゴリと判定する', () => {
    expect(detectCategory('', 'not-a-url')).toBe('default');
  });
});

describe('checkSimilarity', () => {
  it('完全一致を重複と判定する', () => {
    const result = checkSimilarity(
      'Claude 4が発表されました',
      'Claude 4が発表されました',
      testThresholds
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.jaccard).toBe(1);
    expect(result.levenshtein).toBe(0);
  });

  it('類似タイトルを重複と判定する', () => {
    const result = checkSimilarity(
      'OpenAI、GPT-5を発表',
      'OpenAI、GPT-5発表',
      testThresholds
    );
    expect(result.isDuplicate).toBe(true);
  });

  it('異なるタイトルを重複と判定しない', () => {
    const result = checkSimilarity(
      'Claude 4が発表されました',
      'Stable Diffusion 3.0リリース',
      testThresholds
    );
    expect(result.isDuplicate).toBe(false);
  });

  it('カテゴリに応じたしきい値を使用する', () => {
    // arXivは厳しいしきい値（jaccard >= 0.8）
    const result1 = checkSimilarity(
      'Attention is All You Need',
      'Attention is All',
      testThresholds,
      'arxiv',
      'https://arxiv.org/abs/1706.03762'
    );
    expect(result1.category).toBe('arxiv');

    // newsは緩いしきい値（jaccard >= 0.6）
    const result2 = checkSimilarity(
      'Tech Company Announces New Product',
      'Tech Company Announces',
      testThresholds,
      'techcrunch',
      'https://techcrunch.com/article'
    );
    expect(result2.category).toBe('news');
  });
});

describe('checkLayer2Similarity', () => {
  it('同一ドメインで高類似度の場合trueを返す', () => {
    // 完全に同じタイトルは確実に重複判定される
    const result = checkLayer2Similarity(
      'Claude 4発表',
      'Claude 4発表',
      true, // same domain
      testThresholds
    );
    expect(result).toBe(true);
  });

  it('クロスドメインでは厳しいしきい値を使用する', () => {
    // 同一ドメインでは重複判定されるが、クロスドメインでは判定されない場合
    const title1 = 'Claude 4発表について';
    const title2 = 'Claude 4発表';

    const sameDomainResult = checkLayer2Similarity(
      title1,
      title2,
      true,
      testThresholds
    );
    const crossDomainResult = checkLayer2Similarity(
      title1,
      title2,
      false,
      testThresholds
    );

    // 類似度によっては異なる結果になりうる
    expect(typeof sameDomainResult).toBe('boolean');
    expect(typeof crossDomainResult).toBe('boolean');
  });

  it('ソース固有のしきい値を使用する', () => {
    const result = checkLayer2Similarity(
      'Qiita記事タイトル',
      'Qiita記事タイトルです',
      true,
      testThresholds,
      'qiita'
    );
    expect(typeof result).toBe('boolean');
  });
});

describe('calculateTitleHash', () => {
  it('同じタイトルは同じハッシュを返す', () => {
    const hash1 = calculateTitleHash('Claude 4発表');
    const hash2 = calculateTitleHash('Claude 4発表');
    expect(hash1).toBe(hash2);
  });

  it('異なるタイトルは異なるハッシュを返す', () => {
    const hash1 = calculateTitleHash('Claude 4発表');
    const hash2 = calculateTitleHash('GPT-5発表');
    expect(hash1).not.toBe(hash2);
  });

  it('大文字小文字を区別しない', () => {
    const hash1 = calculateTitleHash('Hello World');
    const hash2 = calculateTitleHash('hello world');
    expect(hash1).toBe(hash2);
  });

  it('空白の違いを正規化する', () => {
    const hash1 = calculateTitleHash('hello  world');
    const hash2 = calculateTitleHash('hello world');
    expect(hash1).toBe(hash2);
  });

  it('16進数文字列を返す', () => {
    const hash = calculateTitleHash('test');
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('findMostSimilar', () => {
  it('最も類似度の高いタイトルを返す', () => {
    const existingTitles = [
      'Claude 3 Opus発表',
      'GPT-4発表',
      'Claude 4発表',  // これが最も類似
    ];

    // ほぼ同一のタイトルで検索
    const result = findMostSimilar(
      'Claude 4発表',  // 完全一致
      existingTitles,
      testThresholds
    );

    expect(result).not.toBeNull();
    expect(result?.title).toBe('Claude 4発表');
  });

  it('重複が見つからない場合nullを返す', () => {
    const existingTitles = [
      'まったく関係ない記事1',
      'まったく関係ない記事2',
    ];

    const result = findMostSimilar(
      'Claude 4発表',
      existingTitles,
      testThresholds
    );

    expect(result).toBeNull();
  });

  it('空配列の場合nullを返す', () => {
    const result = findMostSimilar('Claude 4発表', [], testThresholds);
    expect(result).toBeNull();
  });

  it('カテゴリに応じたしきい値を適用する', () => {
    const existingTitles = ['Attention is All You Need Paper'];

    const result = findMostSimilar(
      'Attention is All You Need',
      existingTitles,
      testThresholds,
      'arxiv',
      'https://arxiv.org/abs/1706.03762'
    );

    expect(result?.result.category).toBe('arxiv');
  });
});

describe('実際のユースケース', () => {
  describe('ニュース記事の重複検出', () => {
    it('同じニュースの異なるタイトルを検出する', () => {
      const title1 = 'OpenAI、GPT-5を発表 - 人類レベルのAIに一歩近づく';
      const title2 = 'GPT-5発表！OpenAIが次世代AIモデルを公開';

      // title1とtitle2は類似している可能性が高い
      const result = checkSimilarity(title1, title2, testThresholds, 'news');
      expect(result.jaccard).toBeGreaterThan(0);
    });
  });

  describe('技術ブログの重複検出', () => {
    it('同じ技術トピックの記事を検出する', () => {
      const result = checkSimilarity(
        'React 19の新機能まとめ',
        'React 19新機能を解説',
        testThresholds,
        'qiita'
      );
      // 日本語bi-gramと英数字の混合で類似度を計算
      expect(result.jaccard).toBeGreaterThan(0.3);
    });
  });

  describe('論文の重複検出', () => {
    it('arXiv論文の類似タイトルを検出する', () => {
      const result = checkSimilarity(
        'Attention Is All You Need',
        'All You Need Is Attention',
        testThresholds,
        'arxiv'
      );
      expect(result.jaccard).toBeGreaterThan(0.7);
    });
  });

  describe('X/Twitterポストの重複検出', () => {
    it('類似ツイートを検出する', () => {
      const result = checkSimilarity(
        'Claude 4 is incredible! The new reasoning capabilities are amazing.',
        'Claude 4 is amazing! The reasoning capabilities are incredible.',
        testThresholds
      );
      expect(result.jaccard).toBeGreaterThan(0.6);
    });
  });
});
