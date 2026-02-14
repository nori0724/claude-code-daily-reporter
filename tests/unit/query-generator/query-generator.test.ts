import { describe, it, expect, beforeEach } from 'vitest';
import {
  QueryGenerator,
  createQueryGenerator,
  type GeneratedQuery,
  type WeightCalculationOptions,
} from '@/query-generator/index';
import type { TagSynonyms, QueriesConfig, QueryGroup } from '@/types/index';

describe('QueryGenerator', () => {
  const testSynonyms: TagSynonyms = {
    LLM: ['Claude', 'GPT', 'ChatGPT', 'Agent', 'RAG'],
    '画像生成': ['Stable Diffusion', 'DALL-E', 'Midjourney'],
    '映像生成': ['Sora', 'Runway', '動画生成'],
    '3DCG': ['Gaussian Splatting', 'NeRF', '3D'],
    MCP: ['Model Context Protocol', 'Claude Code'],
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
      keywords: ['Stable Diffusion', 'DALL-E', 'Midjourney'],
      weight: 1.0,
    },
    {
      id: 'video_gen',
      name: '映像生成',
      keywords: ['Sora', 'Runway', '動画生成'],
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
      keywords: ['MCP', 'Claude Code', 'ツール連携'],
      weight: 1.2,
    },
  ];

  const testConfig: QueriesConfig = {
    queryGroups: testQueryGroups,
    selection: {
      topN: 20,
      maxPerSource: 5,
    },
    combinedQueries: {
      enabled: true,
      maxCombinations: 3,
    },
    dateRestriction: {
      enabled: true,
      withinDays: 7,
    },
    recalculation: {
      interval: 'monthly',
      basedOn: 'data/ナレッジシェアDB_all.csv',
    },
  };

  let generator: QueryGenerator;

  beforeEach(() => {
    generator = createQueryGenerator(testSynonyms, testConfig);
  });

  describe('generate', () => {
    it('クエリを生成する', () => {
      const result = generator.generate();

      expect(result.queries.length).toBeGreaterThan(0);
      expect(result.stats.totalQueries).toBeGreaterThan(0);
    });

    it('重み順にソートされたクエリを返す', () => {
      const result = generator.generate();

      for (let i = 1; i < result.queries.length; i++) {
        const prev = result.queries[i - 1];
        const curr = result.queries[i];
        expect(prev?.finalWeight).toBeGreaterThanOrEqual(curr?.finalWeight ?? 0);
      }
    });

    it('上位Nクエリを選択する', () => {
      const result = generator.generate();

      expect(result.queries.length).toBeLessThanOrEqual(testConfig.selection.topN);
      expect(result.stats.selectedQueries).toBeLessThanOrEqual(testConfig.selection.topN);
    });

    it('各クエリに必要な情報が含まれる', () => {
      const result = generator.generate();
      const query = result.queries[0];

      expect(query?.query).toBeDefined();
      expect(query?.groupId).toBeDefined();
      expect(query?.groupName).toBeDefined();
      expect(query?.baseWeight).toBeDefined();
      expect(query?.finalWeight).toBeDefined();
      expect(query?.keywords).toBeDefined();
    });

    it('直近タイトルに基づいて重みを調整する', () => {
      const recentTitles = [
        'Claude 4発表',
        'GPT-5発表',
        'Claude Code入門',
        'LLM活用術',
      ];

      const result = generator.generate(recentTitles);

      // LLM関連のクエリの重みが高くなるはず
      const llmQueries = result.queries.filter((q) => q.groupId === 'llm');
      const otherQueries = result.queries.filter((q) => q.groupId !== 'llm');

      if (llmQueries.length > 0 && otherQueries.length > 0) {
        const avgLlmWeight =
          llmQueries.reduce((sum, q) => sum + q.finalWeight, 0) / llmQueries.length;
        const avgOtherWeight =
          otherQueries.reduce((sum, q) => sum + q.finalWeight, 0) / otherQueries.length;

        expect(avgLlmWeight).toBeGreaterThan(avgOtherWeight);
      }
    });

    it('全期間タイトルも重み計算に使用する', () => {
      const recentTitles = ['Claude 4発表'];
      const allTitles = [
        'Stable Diffusion入門',
        'Midjourney活用',
        'DALL-E 3の使い方',
        '画像生成AI比較',
      ];

      const result = generator.generate(recentTitles, allTitles);

      // 全期間で画像生成が多いので、画像生成クエリの重みも上がる
      const imageQueries = result.queries.filter((q) => q.groupId === 'image_gen');
      expect(imageQueries.length).toBeGreaterThan(0);
    });

    it('統計情報を返す', () => {
      const result = generator.generate();

      expect(result.stats.totalQueries).toBeGreaterThan(0);
      expect(result.stats.selectedQueries).toBeGreaterThan(0);
      expect(result.stats.topGroups).toBeDefined();
      expect(result.stats.topGroups.length).toBeLessThanOrEqual(5);
    });
  });

  describe('組み合わせクエリ', () => {
    it('有効な場合、組み合わせクエリを生成する', () => {
      const result = generator.generate();

      // 組み合わせクエリは keywords.length === 2 で識別
      const combinedQueries = result.queries.filter(
        (q) => q.keywords.length === 2
      );
      expect(combinedQueries.length).toBeGreaterThan(0);
    });

    it('無効な場合、組み合わせクエリを生成しない', () => {
      const configNoCombined: QueriesConfig = {
        ...testConfig,
        combinedQueries: { enabled: false, maxCombinations: 0 },
      };
      const gen = createQueryGenerator(testSynonyms, configNoCombined);
      const result = gen.generate();

      // 組み合わせクエリは keywords.length === 2 で識別
      // （元のキーワードにスペースが含まれる場合があるため、query.split(' ')では判定できない）
      const combinedQueries = result.queries.filter(
        (q) => q.keywords.length === 2
      );
      expect(combinedQueries.length).toBe(0);
    });

    it('maxCombinationsを超えない', () => {
      const result = generator.generate();

      // 各グループの組み合わせクエリ数をカウント
      // 組み合わせクエリは keywords.length === 2 で識別
      const combinedByGroup = new Map<string, number>();
      for (const query of result.queries) {
        if (query.keywords.length === 2) {
          combinedByGroup.set(
            query.groupId,
            (combinedByGroup.get(query.groupId) ?? 0) + 1
          );
        }
      }

      // 各グループの組み合わせクエリがmaxCombinations以下
      for (const count of combinedByGroup.values()) {
        expect(count).toBeLessThanOrEqual(testConfig.combinedQueries.maxCombinations);
      }
    });
  });

  describe('getQueriesForSource', () => {
    it('ソースに割り当てるクエリを取得する', () => {
      const result = generator.generate();
      const sourceQueries = generator.getQueriesForSource('techcrunch', result.queries);

      expect(sourceQueries.length).toBeLessThanOrEqual(testConfig.selection.maxPerSource);
    });

    it('各グループから最大1つずつ選択する', () => {
      const result = generator.generate();
      const sourceQueries = generator.getQueriesForSource('qiita', result.queries);

      const groupIds = sourceQueries.map((q) => q.groupId);
      const uniqueGroupIds = new Set(groupIds);

      expect(groupIds.length).toBe(uniqueGroupIds.size);
    });

    it('空のクエリ配列を渡すと空配列を返す', () => {
      const sourceQueries = generator.getQueriesForSource('techcrunch', []);
      expect(sourceQueries).toHaveLength(0);
    });
  });

  describe('getDateRestrictionDays', () => {
    it('有効な場合、日数を返す', () => {
      const days = generator.getDateRestrictionDays();
      expect(days).toBe(7);
    });

    it('無効な場合、nullを返す', () => {
      const configNoDateRestriction: QueriesConfig = {
        ...testConfig,
        dateRestriction: { enabled: false, withinDays: 7 },
      };
      const gen = createQueryGenerator(testSynonyms, configNoDateRestriction);
      const days = gen.getDateRestrictionDays();
      expect(days).toBeNull();
    });
  });

  describe('buildDateRestrictedQuery', () => {
    it('日付制限が有効な場合、クエリを構築する', () => {
      const query: GeneratedQuery = {
        query: 'Claude',
        groupId: 'llm',
        groupName: 'LLM',
        baseWeight: 1.5,
        finalWeight: 1.5,
        keywords: ['Claude'],
      };

      const restricted = generator.buildDateRestrictedQuery(query);
      expect(restricted).toBe('Claude'); // 現在の実装ではそのまま返す
    });
  });

  describe('getTagNormalizer / getTitleAnalyzer', () => {
    it('タグ正規化インスタンスを取得できる', () => {
      const tagNormalizer = generator.getTagNormalizer();
      expect(tagNormalizer.normalize('Claude')).toBe('LLM');
    });

    it('タイトル分析インスタンスを取得できる', () => {
      const titleAnalyzer = generator.getTitleAnalyzer();
      expect(titleAnalyzer.isRelevant('Claude 4発表')).toBe(true);
    });
  });

  describe('WeightCalculationOptions', () => {
    it('カスタム重み計算オプションを使用できる', () => {
      const customOptions: WeightCalculationOptions = {
        recencyFactorRange: { min: 0.3, max: 2.0 },
        frequencyFactorRange: { min: 0.5, max: 1.5 },
        recentTitlesCount: 50,
      };

      const gen = createQueryGenerator(testSynonyms, testConfig, customOptions);
      const result = gen.generate(['Claude発表', 'Claude発表', 'Claude発表']);

      expect(result.queries.length).toBeGreaterThan(0);
    });
  });

  describe('createQueryGenerator', () => {
    it('ファクトリ関数でインスタンスを作成できる', () => {
      const instance = createQueryGenerator(testSynonyms, testConfig);
      expect(instance).toBeInstanceOf(QueryGenerator);
    });
  });

  describe('実際のユースケース', () => {
    describe('日次クエリ生成', () => {
      it('ナレッジシェアDBからクエリを生成する', () => {
        const recentTitles = [
          'Claude 4 Opusがリリース',
          'GPT-5の性能評価',
          'RAGシステム構築入門',
          'Stable Diffusion 3.0の使い方',
        ];

        const allTitles = [
          ...recentTitles,
          'LLM活用ベストプラクティス',
          'Gaussian Splatting入門',
          'MCPでツール連携',
        ];

        const result = generator.generate(recentTitles, allTitles);

        expect(result.queries.length).toBeGreaterThan(0);
        expect(result.stats.topGroups.length).toBeGreaterThan(0);
      });
    });

    describe('ソース別クエリ割り当て', () => {
      it('複数ソースに対してクエリを割り当てる', () => {
        const result = generator.generate();
        const sources = ['techcrunch', 'qiita', 'zenn', 'arxiv'];

        const assignments = new Map<string, GeneratedQuery[]>();
        for (const source of sources) {
          assignments.set(source, generator.getQueriesForSource(source, result.queries));
        }

        // 各ソースにクエリが割り当てられる
        for (const [source, queries] of assignments) {
          expect(queries.length).toBeGreaterThan(0);
          expect(queries.length).toBeLessThanOrEqual(testConfig.selection.maxPerSource);
        }
      });
    });
  });
});
