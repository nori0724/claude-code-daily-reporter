import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/collector/sdk-executor', () => ({
  executeWebFetch: vi.fn(),
  executeWebSearch: vi.fn(),
}));

import { createCollector } from '@/collector/index';
import { executeWebFetch } from '@/collector/sdk-executor';
import type { GeneratedQuery, SourceConfig, SourcesConfig } from '@/types/index';

const queries: GeneratedQuery[] = [
  {
    query: 'LLM',
    groupId: 'llm',
    groupName: 'LLM',
    baseWeight: 1,
    finalWeight: 1,
    keywords: ['LLM'],
  },
];

function buildSourcesConfig(sources: SourceConfig[]): SourcesConfig {
  return {
    sources,
    rateControl: {
      maxConcurrency: 1,
      defaultTimeout: 30000,
      defaultRetryInterval: 100,
      defaultMaxRetries: 1,
      perSource: Object.fromEntries(
        sources.map((source) => [
          source.id,
          {
            timeout: 30000,
            retryInterval: 100,
            maxRetries: source.tier === 1 ? 3 : 1,
          },
        ])
      ),
    },
  };
}

describe('Collector', () => {
  const mockedExecuteWebFetch = vi.mocked(executeWebFetch);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('buildTask uses WebSearch for openai_news', () => {
    const source: SourceConfig = {
      id: 'openai_news',
      name: 'OpenAI News',
      tier: 1,
      enabled: true,
      collectMethod: 'WebSearch',
      query: 'site:openai.com/news',
      dateMethod: 'search_result',
      maxArticles: 10,
    };

    const collector = createCollector({
      sourcesConfig: buildSourcesConfig([source]),
      queries,
    });

    const task = collector.buildTask(source);

    expect(task.method).toBe('WebSearch');
    expect(task.query).toContain('site:openai.com/news');
  });

  it('retries once with strict JSON repair for anthropic parse failure', async () => {
    const source: SourceConfig = {
      id: 'anthropic_blog',
      name: 'Anthropic Blog',
      tier: 1,
      enabled: true,
      collectMethod: 'WebFetch',
      url: 'https://www.anthropic.com/news',
      dateMethod: 'html_meta',
      maxArticles: 10,
    };

    mockedExecuteWebFetch.mockResolvedValueOnce({
      success: true,
      content: 'The extraction completed. Here are major topics without JSON.',
    });

    mockedExecuteWebFetch.mockResolvedValueOnce({
      success: true,
      content: '{"articles":[{"title":"Anthropic update","url":"https://www.anthropic.com/news/a"}]}',
    });

    const collector = createCollector({
      sourcesConfig: buildSourcesConfig([source]),
      queries,
    });

    const result = await collector.collectFromSource(source);

    expect(mockedExecuteWebFetch).toHaveBeenCalledTimes(2);
    expect(mockedExecuteWebFetch.mock.calls[1]?.[1]).toContain('JSON');
    expect(result.error).toBeUndefined();
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.source).toBe('anthropic_blog');
  });

  it('does not retry strict JSON repair for non-anthropic sources', async () => {
    const source: SourceConfig = {
      id: 'cursor_blog',
      name: 'Cursor Blog',
      tier: 2,
      enabled: true,
      collectMethod: 'WebFetch',
      url: 'https://cursor.com/blog',
      dateMethod: 'html_meta',
      maxArticles: 5,
    };

    mockedExecuteWebFetch.mockResolvedValueOnce({
      success: true,
      content: 'Not in JSON format',
    });

    const collector = createCollector({
      sourcesConfig: buildSourcesConfig([source]),
      queries,
    });

    const result = await collector.collectFromSource(source);

    expect(mockedExecuteWebFetch).toHaveBeenCalledTimes(1);
    expect(result.error?.errorType).toBe('parse');
  });
});
