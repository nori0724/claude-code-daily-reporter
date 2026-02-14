import { describe, it, expect, beforeEach } from 'vitest';
import { TagNormalizer, createTagNormalizer } from '@/query-generator/tag-normalizer';
import type { TagSynonyms } from '@/types/index';

describe('TagNormalizer', () => {
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

  let normalizer: TagNormalizer;

  beforeEach(() => {
    normalizer = createTagNormalizer(testSynonyms);
  });

  describe('normalize', () => {
    it('正規化タグ自体を渡すとそのまま返す', () => {
      expect(normalizer.normalize('LLM')).toBe('LLM');
    });

    it('同義語を正規化タグに変換する', () => {
      expect(normalizer.normalize('Claude')).toBe('LLM');
      expect(normalizer.normalize('GPT')).toBe('LLM');
      expect(normalizer.normalize('ChatGPT')).toBe('LLM');
    });

    it('大文字小文字を区別しない', () => {
      expect(normalizer.normalize('llm')).toBe('LLM');
      expect(normalizer.normalize('CLAUDE')).toBe('LLM');
      expect(normalizer.normalize('chatgpt')).toBe('LLM');
    });

    it('日本語の同義語を正規化する', () => {
      expect(normalizer.normalize('大規模言語モデル')).toBe('LLM');
      expect(normalizer.normalize('AIエージェント')).toBe('LLM');
    });

    it('存在しないタグはnullを返す', () => {
      expect(normalizer.normalize('unknown')).toBeNull();
      expect(normalizer.normalize('')).toBeNull();
    });

    it('前後の空白を除去して正規化する', () => {
      expect(normalizer.normalize('  LLM  ')).toBe('LLM');
      expect(normalizer.normalize('\tClaude\n')).toBe('LLM');
    });
  });

  describe('extractTags', () => {
    it('テキストからタグを抽出する', () => {
      const text = 'Claude 4が発表されました';
      const tags = normalizer.extractTags(text);
      expect(tags).toContain('LLM');
    });

    it('複数のタグを抽出する', () => {
      const text = 'Claude APIでStable Diffusionを動かす';
      const tags = normalizer.extractTags(text);
      expect(tags).toContain('LLM');
      expect(tags).toContain('画像生成');
    });

    it('同じタグを重複して抽出しない', () => {
      const text = 'GPT-4とChatGPTの比較';
      const tags = normalizer.extractTags(text);
      const llmCount = tags.filter((t) => t === 'LLM').length;
      expect(llmCount).toBe(1);
    });

    it('タグが見つからない場合は空配列を返す', () => {
      const text = '今日の天気は晴れです';
      const tags = normalizer.extractTags(text);
      expect(tags).toHaveLength(0);
    });

    it('日本語テキストからタグを抽出する', () => {
      const text = '動画生成AIの最新動向';
      const tags = normalizer.extractTags(text);
      expect(tags).toContain('映像生成');
    });

    it('英語テキストからタグを抽出する', () => {
      const text = 'Introduction to RAG systems';
      const tags = normalizer.extractTags(text);
      expect(tags).toContain('LLM');
    });

    it('複合語を含むテキストからタグを抽出する', () => {
      const text = 'Model Context Protocolの解説';
      const tags = normalizer.extractTags(text);
      expect(tags).toContain('MCP');
    });
  });

  describe('extractTagsFromMany', () => {
    it('複数テキストからタグを集計する', () => {
      const texts = [
        'Claude 4の新機能',
        'GPT-5の発表',
        'Stable Diffusion 3.0リリース',
        'Claude Codeの使い方',
      ];
      const tagCounts = normalizer.extractTagsFromMany(texts);

      expect(tagCounts.get('LLM')).toBe(3); // Claude x2, GPT x1
      expect(tagCounts.get('画像生成')).toBe(1);
    });

    it('空配列を渡すと空のMapを返す', () => {
      const tagCounts = normalizer.extractTagsFromMany([]);
      expect(tagCounts.size).toBe(0);
    });
  });

  describe('getAllNormalizedTags', () => {
    it('すべての正規化タグを返す', () => {
      const tags = normalizer.getAllNormalizedTags();
      expect(tags).toContain('LLM');
      expect(tags).toContain('3DCG');
      expect(tags).toContain('映像生成');
      expect(tags).toContain('画像生成');
      expect(tags).toContain('MCP');
      expect(tags).toHaveLength(5);
    });
  });

  describe('getSynonyms', () => {
    it('正規化タグの同義語を返す', () => {
      const synonyms = normalizer.getSynonyms('LLM');
      expect(synonyms).toContain('Claude');
      expect(synonyms).toContain('GPT');
      expect(synonyms).toContain('大規模言語モデル');
    });

    it('存在しないタグは空配列を返す', () => {
      const synonyms = normalizer.getSynonyms('unknown');
      expect(synonyms).toHaveLength(0);
    });
  });

  describe('matchesTag', () => {
    it('正規化タグにマッチする場合trueを返す', () => {
      expect(normalizer.matchesTag('LLMの解説', 'LLM')).toBe(true);
    });

    it('同義語にマッチする場合trueを返す', () => {
      expect(normalizer.matchesTag('Claude 4発表', 'LLM')).toBe(true);
      expect(normalizer.matchesTag('GPT-5の性能', 'LLM')).toBe(true);
    });

    it('マッチしない場合falseを返す', () => {
      expect(normalizer.matchesTag('今日の天気', 'LLM')).toBe(false);
    });

    it('大文字小文字を区別しない', () => {
      expect(normalizer.matchesTag('claude is great', 'LLM')).toBe(true);
    });
  });

  describe('createTagNormalizer', () => {
    it('ファクトリ関数でインスタンスを作成できる', () => {
      const instance = createTagNormalizer(testSynonyms);
      expect(instance).toBeInstanceOf(TagNormalizer);
      expect(instance.normalize('Claude')).toBe('LLM');
    });
  });
});
