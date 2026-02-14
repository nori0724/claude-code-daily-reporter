import { describe, it, expect } from 'vitest';
import { parseCollectionResult } from '@/collector/prompts';

describe('parseCollectionResult', () => {
  it('parses json fenced response', () => {
    const response = `\n\
\`\`\`json\n{\n  "articles": [\n    {\n      "title": "Article A",\n      "url": "https://example.com/a",\n      "summary": "summary"\n    }\n  ]\n}\n\`\`\``;

    const result = parseCollectionResult(response, 'test_source');
    expect(result.parseError).toBeUndefined();
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.source).toBe('test_source');
  });

  it('parses object embedded in prose', () => {
    const response = `記事情報の抽出が完了しました。\n\n{\n  "articles": [\n    { "title": "Article B", "url": "https://example.com/b" }\n  ]\n}`;

    const result = parseCollectionResult(response, 'test_source');
    expect(result.parseError).toBeUndefined();
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.title).toBe('Article B');
  });

  it('returns parseError with raw preview when no JSON is present', () => {
    const response = '残念ながら、OpenAI Newsの最新記事を抽出できませんでした。';

    const result = parseCollectionResult(response, 'test_source');
    expect(result.articles).toHaveLength(0);
    expect(result.parseError).toBeTruthy();
    expect(result.rawPreview).toContain('OpenAI News');
  });

  it('accepts top-level array response', () => {
    const response = JSON.stringify([
      { title: 'Article C', url: 'https://example.com/c' },
      { title: 'Article D', url: 'https://example.com/d' },
    ]);

    const result = parseCollectionResult(response, 'test_source');
    expect(result.parseError).toBeUndefined();
    expect(result.articles).toHaveLength(2);
  });
});
