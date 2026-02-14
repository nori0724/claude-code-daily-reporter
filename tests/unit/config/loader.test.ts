import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { disableSources } from '@/config/loader';
import type { SourcesConfig } from '@/types/index';

describe('disableSources', () => {
  it('disables matching enabled sources and persists to file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'daily-reporter-'));
    const configPath = join(tmpDir, 'sources.json');

    const fixture: SourcesConfig = {
      sources: [
        {
          id: 'hackernews',
          name: 'HackerNews',
          tier: 1,
          enabled: true,
          collectMethod: 'WebFetch',
          url: 'https://news.ycombinator.com/',
          dateMethod: 'html_parse',
          maxArticles: 10,
        },
        {
          id: 'openai_news',
          name: 'OpenAI News',
          tier: 1,
          enabled: true,
          collectMethod: 'WebFetch',
          url: 'https://openai.com/news/',
          dateMethod: 'html_meta',
          maxArticles: 10,
        },
      ],
      rateControl: {
        maxConcurrency: 1,
        defaultTimeout: 30000,
        defaultRetryInterval: 5000,
        defaultMaxRetries: 1,
        perSource: {},
      },
    };

    writeFileSync(configPath, JSON.stringify(fixture, null, 2), 'utf-8');

    const disabled = disableSources(['hackernews', 'unknown_source'], configPath);
    expect(disabled).toEqual(['hackernews']);

    const updated = JSON.parse(readFileSync(configPath, 'utf-8')) as SourcesConfig;
    expect(updated.sources.find((s) => s.id === 'hackernews')?.enabled).toBe(false);
    expect(updated.sources.find((s) => s.id === 'openai_news')?.enabled).toBe(true);
  });

  it('does not rewrite when nothing is disabled', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'daily-reporter-'));
    const configPath = join(tmpDir, 'sources.json');

    const fixture: SourcesConfig = {
      sources: [
        {
          id: 'hackernews',
          name: 'HackerNews',
          tier: 1,
          enabled: false,
          collectMethod: 'WebFetch',
          url: 'https://news.ycombinator.com/',
          dateMethod: 'html_parse',
          maxArticles: 10,
        },
      ],
      rateControl: {
        maxConcurrency: 1,
        defaultTimeout: 30000,
        defaultRetryInterval: 5000,
        defaultMaxRetries: 1,
        perSource: {},
      },
    };

    writeFileSync(configPath, JSON.stringify(fixture, null, 2), 'utf-8');

    const disabled = disableSources(['hackernews'], configPath);
    expect(disabled).toEqual([]);
  });
});
