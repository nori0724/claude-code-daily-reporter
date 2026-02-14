import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HistoryStore, createHistoryStore } from '@/deduplicator/history-store';
import type { HistoryEntry } from '@/types/index';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('HistoryStore', () => {
  let store: HistoryStore;
  let dbPath: string;

  beforeEach(() => {
    // 一時ディレクトリにテスト用DBを作成
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-store-test-'));
    dbPath = path.join(tmpDir, 'test-history.db');
    store = createHistoryStore({
      path: dbPath,
      retentionDays: 90,
    });
  });

  afterEach(() => {
    store.close();
    // テスト用DBを削除
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      // WALファイルも削除
      const walPath = dbPath + '-wal';
      const shmPath = dbPath + '-shm';
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
    }
    const tmpDir = path.dirname(dbPath);
    if (fs.existsSync(tmpDir)) {
      fs.rmdirSync(tmpDir);
    }
  });

  const createTestEntry = (overrides: Partial<HistoryEntry> = {}): Omit<HistoryEntry, 'id'> => ({
    url: 'https://example.com/article',
    normalizedUrl: 'https://example.com/article',
    title: 'Test Article',
    firstSeenAt: '2024-01-15T10:00:00.000Z',
    lastSeenAt: '2024-01-15T10:00:00.000Z',
    dateConfidence: 'high',
    source: 'test_source',
    ...overrides,
  });

  describe('初期化', () => {
    it('データベースを正常に初期化できる', () => {
      expect(store).toBeDefined();
      const stats = store.getStats();
      expect(stats.totalEntries).toBe(0);
    });

    it('createHistoryStoreファクトリ関数で作成できる', () => {
      const newStore = createHistoryStore({
        path: ':memory:',
        retentionDays: 90,
      });
      expect(newStore).toBeInstanceOf(HistoryStore);
      newStore.close();
    });
  });

  describe('upsert', () => {
    it('新規エントリを追加できる', () => {
      const entry = createTestEntry();
      const result = store.upsert(entry);

      expect(result.id).toBeDefined();
      expect(result.url).toBe(entry.url);
      expect(result.title).toBe(entry.title);
    });

    it('既存エントリを更新できる（last_seen_atが更新される）', () => {
      const entry = createTestEntry();
      store.upsert(entry);

      const updated = store.upsert({
        ...entry,
        lastSeenAt: '2024-01-20T10:00:00.000Z',
      });

      const found = store.findByNormalizedUrl(entry.normalizedUrl);
      expect(found?.lastSeenAt).toBe('2024-01-20T10:00:00.000Z');
      // firstSeenAtは変更されない
      expect(found?.firstSeenAt).toBe('2024-01-15T10:00:00.000Z');
    });

    it('publishedAtを後から追加できる', () => {
      const entry = createTestEntry();
      store.upsert(entry);

      store.upsert({
        ...entry,
        publishedAt: '2024-01-10T08:00:00.000Z',
        lastSeenAt: '2024-01-16T10:00:00.000Z',
      });

      const found = store.findByNormalizedUrl(entry.normalizedUrl);
      expect(found?.publishedAt).toBe('2024-01-10T08:00:00.000Z');
    });

    it('titleHashとcontentHashを保存できる', () => {
      const entry = createTestEntry({
        titleHash: 'abc123',
        contentHash: 'def456',
      });
      store.upsert(entry);

      const found = store.findByNormalizedUrl(entry.normalizedUrl);
      expect(found?.titleHash).toBe('abc123');
      expect(found?.contentHash).toBe('def456');
    });
  });

  describe('bulkUpsert', () => {
    it('複数エントリを一括追加できる', () => {
      const entries = [
        createTestEntry({ normalizedUrl: 'https://example.com/1', title: 'Article 1' }),
        createTestEntry({ normalizedUrl: 'https://example.com/2', title: 'Article 2' }),
        createTestEntry({ normalizedUrl: 'https://example.com/3', title: 'Article 3' }),
      ];

      const results = store.bulkUpsert(entries);

      expect(results.length).toBe(3);
      expect(store.getStats().totalEntries).toBe(3);
    });

    it('空配列を渡しても問題ない', () => {
      const results = store.bulkUpsert([]);
      expect(results.length).toBe(0);
    });
  });

  describe('findByNormalizedUrl', () => {
    it('存在するURLを検索できる', () => {
      const entry = createTestEntry();
      store.upsert(entry);

      const found = store.findByNormalizedUrl(entry.normalizedUrl);

      expect(found).not.toBeNull();
      expect(found?.title).toBe(entry.title);
    });

    it('存在しないURLはnullを返す', () => {
      const found = store.findByNormalizedUrl('https://nonexistent.com/article');
      expect(found).toBeNull();
    });
  });

  describe('findExistingUrls', () => {
    it('存在するURLのセットを返す', () => {
      const entries = [
        createTestEntry({ normalizedUrl: 'https://example.com/1' }),
        createTestEntry({ normalizedUrl: 'https://example.com/2' }),
      ];
      store.bulkUpsert(entries);

      const existing = store.findExistingUrls([
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/3', // 存在しない
      ]);

      expect(existing.size).toBe(2);
      expect(existing.has('https://example.com/1')).toBe(true);
      expect(existing.has('https://example.com/2')).toBe(true);
      expect(existing.has('https://example.com/3')).toBe(false);
    });

    it('空配列を渡すと空のセットを返す', () => {
      const existing = store.findExistingUrls([]);
      expect(existing.size).toBe(0);
    });
  });

  describe('findByTitleHash', () => {
    it('タイトルハッシュで検索できる', () => {
      const entries = [
        createTestEntry({
          normalizedUrl: 'https://example.com/1',
          title: 'Same Title',
          titleHash: 'hash123',
        }),
        createTestEntry({
          normalizedUrl: 'https://other.com/1',
          title: 'Same Title Copy',
          titleHash: 'hash123',
        }),
        createTestEntry({
          normalizedUrl: 'https://example.com/2',
          title: 'Different Title',
          titleHash: 'hash456',
        }),
      ];
      store.bulkUpsert(entries);

      const found = store.findByTitleHash('hash123');

      expect(found.length).toBe(2);
    });

    it('存在しないハッシュは空配列を返す', () => {
      const found = store.findByTitleHash('nonexistent');
      expect(found.length).toBe(0);
    });
  });

  describe('findByDateRange', () => {
    beforeEach(() => {
      const entries = [
        createTestEntry({
          normalizedUrl: 'https://example.com/old',
          firstSeenAt: '2024-01-01T00:00:00.000Z',
        }),
        createTestEntry({
          normalizedUrl: 'https://example.com/mid',
          firstSeenAt: '2024-01-15T00:00:00.000Z',
        }),
        createTestEntry({
          normalizedUrl: 'https://example.com/new',
          firstSeenAt: '2024-01-30T00:00:00.000Z',
        }),
      ];
      store.bulkUpsert(entries);
    });

    it('開始日以降のエントリを取得できる', () => {
      const found = store.findByDateRange('2024-01-10T00:00:00.000Z');
      expect(found.length).toBe(2);
    });

    it('日付範囲でエントリを取得できる', () => {
      const found = store.findByDateRange(
        '2024-01-10T00:00:00.000Z',
        '2024-01-20T00:00:00.000Z'
      );
      expect(found.length).toBe(1);
      expect(found[0]?.normalizedUrl).toBe('https://example.com/mid');
    });

    it('結果は降順でソートされる', () => {
      const found = store.findByDateRange('2024-01-01T00:00:00.000Z');
      expect(found[0]?.normalizedUrl).toBe('https://example.com/new');
      expect(found[2]?.normalizedUrl).toBe('https://example.com/old');
    });
  });

  describe('cleanup', () => {
    it('指定日より前のエントリを削除する', () => {
      const entries = [
        createTestEntry({
          normalizedUrl: 'https://example.com/old',
          firstSeenAt: '2024-01-01T00:00:00.000Z',
        }),
        createTestEntry({
          normalizedUrl: 'https://example.com/new',
          firstSeenAt: '2024-01-30T00:00:00.000Z',
        }),
      ];
      store.bulkUpsert(entries);

      const deleted = store.cleanup('2024-01-15T00:00:00.000Z');

      expect(deleted).toBe(1);
      expect(store.getStats().totalEntries).toBe(1);
      expect(store.findByNormalizedUrl('https://example.com/old')).toBeNull();
      expect(store.findByNormalizedUrl('https://example.com/new')).not.toBeNull();
    });
  });

  describe('getStats', () => {
    it('空のデータベースの統計を取得できる', () => {
      const stats = store.getStats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.oldestEntry).toBeNull();
      expect(stats.newestEntry).toBeNull();
      expect(Object.keys(stats.entriesBySource).length).toBe(0);
    });

    it('データがある場合の統計を取得できる', () => {
      const entries = [
        createTestEntry({
          normalizedUrl: 'https://example.com/1',
          firstSeenAt: '2024-01-01T00:00:00.000Z',
          source: 'source_a',
        }),
        createTestEntry({
          normalizedUrl: 'https://example.com/2',
          firstSeenAt: '2024-01-15T00:00:00.000Z',
          source: 'source_a',
        }),
        createTestEntry({
          normalizedUrl: 'https://example.com/3',
          firstSeenAt: '2024-01-30T00:00:00.000Z',
          source: 'source_b',
        }),
      ];
      store.bulkUpsert(entries);

      const stats = store.getStats();

      expect(stats.totalEntries).toBe(3);
      expect(stats.oldestEntry).toBe('2024-01-01T00:00:00.000Z');
      expect(stats.newestEntry).toBe('2024-01-30T00:00:00.000Z');
      expect(stats.entriesBySource['source_a']).toBe(2);
      expect(stats.entriesBySource['source_b']).toBe(1);
    });
  });

  describe('findPotentialReposts', () => {
    it('再掲の可能性があるエントリを検出する', () => {
      // first_seen_atとlast_seen_atの差が7日以上
      const entries = [
        createTestEntry({
          normalizedUrl: 'https://example.com/repost',
          firstSeenAt: '2024-01-01T00:00:00.000Z',
          lastSeenAt: '2024-01-10T00:00:00.000Z', // 9日後
        }),
        createTestEntry({
          normalizedUrl: 'https://example.com/normal',
          firstSeenAt: '2024-01-15T00:00:00.000Z',
          lastSeenAt: '2024-01-16T00:00:00.000Z', // 1日後
        }),
      ];
      store.bulkUpsert(entries);

      const reposts = store.findPotentialReposts(7);

      expect(reposts.length).toBe(1);
      expect(reposts[0]?.normalizedUrl).toBe('https://example.com/repost');
    });
  });

  describe('dateConfidence', () => {
    it('各dateConfidence値を正しく保存・取得できる', () => {
      const confidences: Array<'high' | 'medium' | 'low' | 'unknown'> = [
        'high',
        'medium',
        'low',
        'unknown',
      ];

      for (const confidence of confidences) {
        const entry = createTestEntry({
          normalizedUrl: `https://example.com/${confidence}`,
          dateConfidence: confidence,
        });
        store.upsert(entry);

        const found = store.findByNormalizedUrl(entry.normalizedUrl);
        expect(found?.dateConfidence).toBe(confidence);
      }
    });
  });

  describe('エッジケース', () => {
    it('特殊文字を含むURLを処理できる', () => {
      const entry = createTestEntry({
        url: 'https://example.com/path?q=日本語&a=b',
        normalizedUrl: 'https://example.com/path?a=b&q=%E6%97%A5%E6%9C%AC%E8%AA%9E',
      });
      store.upsert(entry);

      const found = store.findByNormalizedUrl(entry.normalizedUrl);
      expect(found).not.toBeNull();
    });

    it('非常に長いタイトルを処理できる', () => {
      const longTitle = 'A'.repeat(10000);
      const entry = createTestEntry({ title: longTitle });
      store.upsert(entry);

      const found = store.findByNormalizedUrl(entry.normalizedUrl);
      expect(found?.title).toBe(longTitle);
    });

    it('同時に多数のエントリを追加できる', () => {
      const entries = Array.from({ length: 1000 }, (_, i) =>
        createTestEntry({
          normalizedUrl: `https://example.com/${i}`,
          title: `Article ${i}`,
        })
      );

      const results = store.bulkUpsert(entries);

      expect(results.length).toBe(1000);
      expect(store.getStats().totalEntries).toBe(1000);
    });
  });
});
