import { describe, it, expect } from 'vitest';
import { findAbortHeavySourceIds } from '@/index';
import type { CollectionError } from '@/types/index';

describe('findAbortHeavySourceIds', () => {
  it('returns unique source ids for abort-heavy failures', () => {
    const errors: CollectionError[] = [
      {
        sourceId: 'hackernews',
        errorType: 'timeout',
        message: 'Claude Code process aborted by user',
        timestamp: new Date().toISOString(),
        retryCount: 3,
      },
      {
        sourceId: 'hackernews',
        errorType: 'timeout',
        message: 'Operation aborted',
        timestamp: new Date().toISOString(),
        retryCount: 3,
      },
      {
        sourceId: 'openai_news',
        errorType: 'timeout',
        message: 'request timeout',
        timestamp: new Date().toISOString(),
        retryCount: 3,
      },
      {
        sourceId: 'twitter',
        errorType: 'timeout',
        message: 'Claude Code process aborted by user',
        timestamp: new Date().toISOString(),
        retryCount: 0,
      },
    ];

    expect(findAbortHeavySourceIds(errors)).toEqual(['hackernews']);
  });
});
