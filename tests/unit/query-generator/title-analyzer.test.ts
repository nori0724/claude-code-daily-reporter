import { describe, it, expect, beforeEach } from 'vitest';
import { TitleAnalyzer, createTitleAnalyzer } from '@/query-generator/title-analyzer';
import { createTagNormalizer } from '@/query-generator/tag-normalizer';
import type { TagSynonyms, QueryGroup } from '@/types/index';

describe('TitleAnalyzer', () => {
  const testSynonyms: TagSynonyms = {
    LLM: [
      '大規模言語モデル',
      'Large Language Model',
      'Claude',
      'GPT',
      'ChatGPT',
      'Gemini',
      'Agent',
      'AIエージェント',
      'RAG',
    ],
    '3DCG': ['3D', 'CG', 'コンピュータグラフィックス'],
    '映像生成': ['動画生成', 'Video Generation', 'Text-to-Video'],
    '画像生成': ['Image Generation', 'Text-to-Image', 'Stable Diffusion'],
    MCP: ['Model Context Protocol', 'モデルコンテキストプロトコル'],
  };

  const testQueryGroups: QueryGroup[] = [
    {
      id: 'llm',
      name: 'LLM/エージェント',
      keywords: ['Claude', 'GPT', 'LLM', 'Agent', 'RAG'],
      weight: 1.5,
    },
    {
      id: 'image_gen',
      name: '画像生成',
      keywords: ['Stable Diffusion', 'DALL-E', 'Midjourney', '画像生成'],
      weight: 1.0,
    },
    {
      id: 'video_gen',
      name: '映像生成',
      keywords: ['Sora', 'Runway', '動画生成', 'Video Generation'],
      weight: 1.0,
    },
    {
      id: '3dcg',
      name: '3DCG',
      keywords: ['Gaussian Splatting', 'NeRF', '3D'],
      weight: 0.8,
    },
    {
      id: 'mcp',
      name: 'MCP/ツール',
      keywords: ['MCP', 'Model Context Protocol', 'Claude Code'],
      weight: 1.2,
    },
  ];

  let analyzer: TitleAnalyzer;

  beforeEach(() => {
    const tagNormalizer = createTagNormalizer(testSynonyms);
    analyzer = createTitleAnalyzer(tagNormalizer, testQueryGroups);
  });

  describe('analyzeTitle', () => {
    it('タイトルからタグを抽出する', () => {
      const result = analyzer.analyzeTitle('Claude 4が発表されました');
      expect(result.tags).toContain('LLM');
    });

    it('マッチするクエリグループを検出する', () => {
      const result = analyzer.analyzeTitle('Claude 4の新機能について');
      expect(result.matchedGroups).toContain('llm');
    });

    it('複数のクエリグループにマッチする場合すべて返す', () => {
      const result = analyzer.analyzeTitle('Claude APIでStable Diffusionを動かす');
      expect(result.matchedGroups).toContain('llm');
      expect(result.matchedGroups).toContain('image_gen');
    });

    it('関連度スコアを計算する', () => {
      const result = analyzer.analyzeTitle('Claude 4発表');
      expect(result.relevanceScore).toBeGreaterThan(0);
      expect(result.relevanceScore).toBeLessThanOrEqual(1);
    });

    it('マッチしないタイトルは空の結果を返す', () => {
      const result = analyzer.analyzeTitle('今日の天気は晴れです');
      expect(result.matchedGroups).toHaveLength(0);
      expect(result.tags).toHaveLength(0);
      expect(result.relevanceScore).toBe(0);
    });

    it('大文字小文字を区別しない', () => {
      const result1 = analyzer.analyzeTitle('CLAUDE 4発表');
      const result2 = analyzer.analyzeTitle('claude 4発表');
      expect(result1.matchedGroups).toEqual(result2.matchedGroups);
    });

    it('日本語キーワードを検出する', () => {
      const result = analyzer.analyzeTitle('画像生成AIの進化');
      expect(result.matchedGroups).toContain('image_gen');
    });

    it('複合キーワードを検出する', () => {
      const result = analyzer.analyzeTitle('Gaussian Splattingの解説');
      expect(result.matchedGroups).toContain('3dcg');
    });
  });

  describe('analyzeInterests', () => {
    it('複数タイトルからグループ別カウントを集計する', () => {
      const titles = [
        'Claude 4の新機能',
        'GPT-5の発表',
        'Stable Diffusion 3.0',
        'Claude Codeの使い方',
      ];
      const analysis = analyzer.analyzeInterests(titles);

      expect(analysis.groupCounts.get('llm')).toBe(3); // Claude x2, GPT x1
      expect(analysis.groupCounts.get('image_gen')).toBe(1);
    });

    it('タグ別カウントを集計する', () => {
      const titles = [
        'Claude 4発表',
        'GPT-5発表',
        'Claudeの使い方',
      ];
      const analysis = analyzer.analyzeInterests(titles);

      expect(analysis.tagCounts.get('LLM')).toBeGreaterThanOrEqual(3);
    });

    it('重み付きスコアを計算する', () => {
      const titles = [
        'Claude 4発表', // llm (weight: 1.5)
        'Stable Diffusion 3.0', // image_gen (weight: 1.0)
      ];
      const analysis = analyzer.analyzeInterests(titles);

      expect(analysis.weightedScores.get('llm')).toBe(1.5);
      expect(analysis.weightedScores.get('image_gen')).toBe(1.0);
    });

    it('空配列を渡すと空の結果を返す', () => {
      const analysis = analyzer.analyzeInterests([]);
      expect(analysis.groupCounts.size).toBe(0);
      expect(analysis.tagCounts.size).toBe(0);
      expect(analysis.weightedScores.size).toBe(0);
    });

    it('マッチしないタイトルのみの場合も空の結果を返す', () => {
      const titles = ['今日の天気', '明日の予定'];
      const analysis = analyzer.analyzeInterests(titles);
      expect(analysis.groupCounts.size).toBe(0);
    });
  });

  describe('getRankedGroups', () => {
    it('スコア順にソートされたグループを返す', () => {
      const titles = [
        'Claude 4発表',
        'GPT-5発表',
        'Claude Codeの使い方',
        'Stable Diffusion 3.0',
      ];
      const ranked = analyzer.getRankedGroups(titles);

      // LLMが最もスコアが高いはず（3回マッチ × 重み1.5）
      expect(ranked[0]?.groupId).toBe('llm');
      expect(ranked[0]?.count).toBe(3);
    });

    it('各グループのカウントを含む', () => {
      const titles = ['Claude 4', 'GPT-5', 'Stable Diffusion'];
      const ranked = analyzer.getRankedGroups(titles);

      const llmGroup = ranked.find((g) => g.groupId === 'llm');
      expect(llmGroup?.count).toBe(2);
    });

    it('空配列の場合は空配列を返す', () => {
      const ranked = analyzer.getRankedGroups([]);
      expect(ranked).toHaveLength(0);
    });
  });

  describe('isRelevant', () => {
    it('マッチするタイトルはtrueを返す', () => {
      expect(analyzer.isRelevant('Claude 4発表')).toBe(true);
      expect(analyzer.isRelevant('Stable Diffusion 3.0')).toBe(true);
    });

    it('マッチしないタイトルはfalseを返す', () => {
      expect(analyzer.isRelevant('今日の天気')).toBe(false);
      expect(analyzer.isRelevant('料理レシピ')).toBe(false);
    });

    it('タグのみマッチする場合もtrueを返す', () => {
      // "大規模言語モデル"はタグとしては検出されるが、キーワードではない
      expect(analyzer.isRelevant('大規模言語モデルの解説')).toBe(true);
    });
  });

  describe('calculateRelevance', () => {
    it('高関連度のタイトルは高いスコアを返す', () => {
      const score = analyzer.calculateRelevance('Claude GPT Agent RAG');
      expect(score).toBeGreaterThan(0.2);
    });

    it('低関連度のタイトルは低いスコアを返す', () => {
      const score = analyzer.calculateRelevance('Stable Diffusion');
      expect(score).toBeLessThan(0.3);
    });

    it('関連なしのタイトルは0を返す', () => {
      const score = analyzer.calculateRelevance('今日の天気');
      expect(score).toBe(0);
    });
  });

  describe('createTitleAnalyzer', () => {
    it('ファクトリ関数でインスタンスを作成できる', () => {
      const tagNormalizer = createTagNormalizer(testSynonyms);
      const instance = createTitleAnalyzer(tagNormalizer, testQueryGroups);
      expect(instance).toBeInstanceOf(TitleAnalyzer);
      expect(instance.isRelevant('Claude 4')).toBe(true);
    });
  });

  describe('実際のユースケース', () => {
    describe('ナレッジシェアのタイトル分析', () => {
      it('技術記事のタイトルを分析できる', () => {
        const titles = [
          'Claude 4 Opusがリリースされました',
          'RAGシステムの構築入門',
          'Gaussian Splattingで3Dシーンを生成する',
          'MCPを使ったツール連携',
          'Stable Diffusion 3.0の新機能',
        ];

        const analysis = analyzer.analyzeInterests(titles);
        const ranked = analyzer.getRankedGroups(titles);

        // 全タイトルが関連あり
        expect(analysis.groupCounts.size).toBeGreaterThan(0);

        // ランキングが生成される
        expect(ranked.length).toBeGreaterThan(0);
      });
    });

    describe('フィルタリング', () => {
      it('関連記事のみをフィルタできる', () => {
        const titles = [
          'Claude 4発表',
          '今日のニュース',
          'GPT-5の性能',
          '天気予報',
          'Stable Diffusion入門',
        ];

        const relevantTitles = titles.filter((t) => analyzer.isRelevant(t));
        expect(relevantTitles).toContain('Claude 4発表');
        expect(relevantTitles).toContain('GPT-5の性能');
        expect(relevantTitles).toContain('Stable Diffusion入門');
        expect(relevantTitles).not.toContain('今日のニュース');
        expect(relevantTitles).not.toContain('天気予報');
      });
    });
  });
});
