import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseISODate,
  parseDateFromUrl,
  parseRelativeTime,
  parseDateMultiLayer,
  calculateWindowStart,
  checkFreshness,
  parseDateByMethod,
} from '@/deduplicator/date-parser';

describe('parseISODate', () => {
  it('有効なISO 8601日付をパースする', () => {
    const result = parseISODate('2024-01-15T10:30:00.000Z');
    expect(result.date).toBe('2024-01-15T10:30:00.000Z');
    expect(result.confidence).toBe('high');
    expect(result.source).toBe('published_at');
  });

  it('タイムゾーン付きの日付をパースする', () => {
    const result = parseISODate('2024-01-15T19:30:00+09:00');
    expect(result.date).not.toBeNull();
    expect(result.confidence).toBe('high');
  });

  it('日付のみの文字列をパースする', () => {
    const result = parseISODate('2024-01-15');
    expect(result.date).not.toBeNull();
    expect(result.confidence).toBe('high');
  });

  it('nullを渡すとunknownを返す', () => {
    const result = parseISODate(null);
    expect(result.date).toBeNull();
    expect(result.confidence).toBe('unknown');
  });

  it('undefinedを渡すとunknownを返す', () => {
    const result = parseISODate(undefined);
    expect(result.date).toBeNull();
    expect(result.confidence).toBe('unknown');
  });

  it('無効な日付文字列はunknownを返す', () => {
    const result = parseISODate('not-a-date');
    expect(result.date).toBeNull();
    expect(result.confidence).toBe('unknown');
    expect(result.rawText).toBe('not-a-date');
  });
});

describe('parseDateFromUrl', () => {
  it('スラッシュ区切りの日付を抽出する', () => {
    const result = parseDateFromUrl('https://example.com/2024/01/15/article');
    expect(result.date).toBe('2024-01-15T00:00:00.000Z');
    expect(result.confidence).toBe('medium');
    expect(result.source).toBe('url_date');
  });

  it('ハイフン区切りの日付を抽出する', () => {
    const result = parseDateFromUrl('https://example.com/posts/2024-01-15/slug');
    expect(result.date).toBe('2024-01-15T00:00:00.000Z');
    expect(result.confidence).toBe('medium');
  });

  it('クエリパラメータの日付を抽出する', () => {
    const result = parseDateFromUrl('https://example.com/article?date=2024-01-15');
    expect(result.date).toBe('2024-01-15T00:00:00.000Z');
  });

  it('連続数字の日付を抽出する', () => {
    const result = parseDateFromUrl('https://example.com/articles/20240115');
    expect(result.date).toBe('2024-01-15T00:00:00.000Z');
  });

  it('TechCrunch形式のURLを処理する', () => {
    const result = parseDateFromUrl('https://techcrunch.com/2024/01/15/article-title');
    expect(result.date).toBe('2024-01-15T00:00:00.000Z');
  });

  it('日付を含まないURLはunknownを返す', () => {
    const result = parseDateFromUrl('https://example.com/article');
    expect(result.date).toBeNull();
    expect(result.confidence).toBe('unknown');
  });

  it('カスタムパターンを使用できる', () => {
    const result = parseDateFromUrl(
      'https://example.com/post-20240115.html',
      'post-(\\d{4})(\\d{2})(\\d{2})'
    );
    expect(result.date).toBe('2024-01-15T00:00:00.000Z');
  });
});

describe('parseRelativeTime', () => {
  // 基準日時を固定
  const referenceDate = new Date('2024-01-15T12:00:00.000Z');

  describe('日本語', () => {
    it('○秒前をパースする', () => {
      const result = parseRelativeTime('30秒前', referenceDate);
      expect(result.date).not.toBeNull();
      expect(result.confidence).toBe('low');
      expect(result.source).toBe('relative_time');
    });

    it('○分前をパースする', () => {
      const result = parseRelativeTime('5分前', referenceDate);
      expect(result.date).not.toBeNull();
      const date = new Date(result.date!);
      expect(date.getUTCMinutes()).toBe(55); // UTC 12:00 - 5分 = UTC 11:55
    });

    it('○時間前をパースする', () => {
      const result = parseRelativeTime('3時間前', referenceDate);
      expect(result.date).not.toBeNull();
      const date = new Date(result.date!);
      expect(date.getUTCHours()).toBe(9); // UTC 12:00 - 3時間 = UTC 9:00
    });

    it('○日前をパースする', () => {
      const result = parseRelativeTime('2日前', referenceDate);
      expect(result.date).not.toBeNull();
      const date = new Date(result.date!);
      expect(date.getUTCDate()).toBe(13);
    });

    it('○週間前をパースする', () => {
      const result = parseRelativeTime('1週間前', referenceDate);
      expect(result.date).not.toBeNull();
      const date = new Date(result.date!);
      expect(date.getUTCDate()).toBe(8);
    });

    it('○ヶ月前をパースする', () => {
      const result = parseRelativeTime('1ヶ月前', referenceDate);
      expect(result.date).not.toBeNull();
      const date = new Date(result.date!);
      expect(date.getUTCMonth()).toBe(11); // December
    });

    it('昨日をパースする', () => {
      const result = parseRelativeTime('昨日', referenceDate);
      expect(result.date).not.toBeNull();
      const date = new Date(result.date!);
      expect(date.getUTCDate()).toBe(14);
    });

    it('今日をパースする', () => {
      const result = parseRelativeTime('今日', referenceDate);
      expect(result.date).not.toBeNull();
      const date = new Date(result.date!);
      expect(date.getUTCDate()).toBe(15);
    });
  });

  describe('英語', () => {
    it('○ seconds agoをパースする', () => {
      const result = parseRelativeTime('30 seconds ago', referenceDate);
      expect(result.date).not.toBeNull();
    });

    it('○ minutes agoをパースする', () => {
      const result = parseRelativeTime('5 minutes ago', referenceDate);
      expect(result.date).not.toBeNull();
    });

    it('○ hours agoをパースする', () => {
      const result = parseRelativeTime('3 hours ago', referenceDate);
      expect(result.date).not.toBeNull();
    });

    it('○ days agoをパースする', () => {
      const result = parseRelativeTime('2 days ago', referenceDate);
      expect(result.date).not.toBeNull();
    });

    it('単数形もパースする', () => {
      const result = parseRelativeTime('1 hour ago', referenceDate);
      expect(result.date).not.toBeNull();
    });

    it('yesterdayをパースする', () => {
      const result = parseRelativeTime('yesterday', referenceDate);
      expect(result.date).not.toBeNull();
    });
  });

  it('パースできないテキストはunknownを返す', () => {
    const result = parseRelativeTime('some random text', referenceDate);
    expect(result.date).toBeNull();
    expect(result.confidence).toBe('unknown');
  });
});

describe('parseDateMultiLayer', () => {
  it('Layer 1（published_at）を優先する', () => {
    const result = parseDateMultiLayer({
      publishedAt: '2024-01-15T10:00:00.000Z',
      url: 'https://example.com/2024/01/10/article',
      relativeTimeText: '2日前',
    });
    expect(result.date).toBe('2024-01-15T10:00:00.000Z');
    expect(result.source).toBe('published_at');
    expect(result.confidence).toBe('high');
  });

  it('Layer 1が無効な場合Layer 2を使用する', () => {
    const result = parseDateMultiLayer({
      publishedAt: null,
      url: 'https://example.com/2024/01/15/article',
      relativeTimeText: '2日前',
    });
    expect(result.date).toBe('2024-01-15T00:00:00.000Z');
    expect(result.source).toBe('url_date');
    expect(result.confidence).toBe('medium');
  });

  it('Layer 1,2が無効な場合Layer 3を使用する', () => {
    const referenceDate = new Date('2024-01-15T12:00:00.000Z');
    const result = parseDateMultiLayer({
      publishedAt: null,
      url: 'https://example.com/article',
      relativeTimeText: '2日前',
      referenceDate,
    });
    expect(result.date).not.toBeNull();
    expect(result.source).toBe('relative_time');
    expect(result.confidence).toBe('low');
  });

  it('すべて無効な場合unknownを返す', () => {
    const result = parseDateMultiLayer({
      publishedAt: null,
      url: 'https://example.com/article',
      relativeTimeText: '',
    });
    expect(result.date).toBeNull();
    expect(result.confidence).toBe('unknown');
    expect(result.source).toBe('first_seen_at');
  });
});

describe('calculateWindowStart', () => {
  it('lastSuccessAtがある場合それを返す', () => {
    const now = new Date('2024-01-15T10:00:00.000Z');
    const lastSuccessAt = '2024-01-14T08:00:00.000Z';

    const windowStart = calculateWindowStart(lastSuccessAt, now);

    expect(windowStart.toISOString()).toBe('2024-01-14T08:00:00.000Z');
  });

  it('lastSuccessAtがない場合24時間前を返す', () => {
    // 月曜日以外
    const now = new Date('2024-01-16T10:00:00.000Z'); // 火曜日

    const windowStart = calculateWindowStart(null, now);
    const expected = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    expect(windowStart.toISOString()).toBe(expected.toISOString());
  });

  it('月曜日でlastSuccessAtがない場合72時間前を返す', () => {
    const now = new Date('2024-01-15T10:00:00.000Z'); // 月曜日

    const windowStart = calculateWindowStart(null, now);
    const expected = new Date(now.getTime() - 72 * 60 * 60 * 1000);

    expect(windowStart.toISOString()).toBe(expected.toISOString());
  });

  it('月曜日でlastSuccessAtが72時間以内の場合lastSuccessAtを返す', () => {
    const now = new Date('2024-01-15T10:00:00.000Z'); // 月曜日
    const lastSuccessAt = '2024-01-14T08:00:00.000Z'; // 26時間前

    const windowStart = calculateWindowStart(lastSuccessAt, now);

    expect(windowStart.toISOString()).toBe('2024-01-14T08:00:00.000Z');
  });
});

describe('checkFreshness', () => {
  const windowStart = new Date('2024-01-14T00:00:00.000Z');

  it('publishedAtが時間窓内の場合freshと判定する', () => {
    const result = checkFreshness({
      publishedAt: '2024-01-15T10:00:00.000Z',
      windowStart,
    });
    expect(result.isFresh).toBe(true);
    expect(result.priority).toBe('high');
    expect(result.dateSource).toBe('published_at');
  });

  it('publishedAtが時間窓外の場合not freshと判定する', () => {
    const result = checkFreshness({
      publishedAt: '2024-01-10T10:00:00.000Z',
      windowStart,
    });
    expect(result.isFresh).toBe(false);
    expect(result.dateSource).toBe('published_at');
  });

  it('publishedAtがない場合urlDateを使用する', () => {
    const result = checkFreshness({
      urlDate: '2024-01-15T00:00:00.000Z',
      windowStart,
    });
    expect(result.isFresh).toBe(true);
    expect(result.priority).toBe('normal');
    expect(result.dateSource).toBe('url_date');
  });

  it('日付が全て不明な場合freshと判定する（取りこぼし防止）', () => {
    const result = checkFreshness({
      windowStart,
    });
    expect(result.isFresh).toBe(true);
    expect(result.priority).toBe('low');
    expect(result.dateSource).toBeNull();
  });

  it('firstSeenAtをフォールバックとして使用する', () => {
    const result = checkFreshness({
      firstSeenAt: '2024-01-15T10:00:00.000Z',
      windowStart,
    });
    expect(result.isFresh).toBe(true);
    expect(result.priority).toBe('low');
    expect(result.dateSource).toBe('first_seen_at');
  });
});

describe('parseDateByMethod', () => {
  it('html_metaメソッドでメタコンテンツをパースする', () => {
    const result = parseDateByMethod('html_meta', {
      metaContent: '2024-01-15T10:00:00.000Z',
    });
    expect(result.date).toBe('2024-01-15T10:00:00.000Z');
    expect(result.confidence).toBe('high');
  });

  it('url_parseメソッドでURLをパースする', () => {
    const result = parseDateByMethod('url_parse', {
      url: 'https://example.com/2024/01/15/article',
    });
    expect(result.date).toBe('2024-01-15T00:00:00.000Z');
    expect(result.confidence).toBe('medium');
  });

  it('search_resultメソッドで相対時刻をパースする', () => {
    const referenceDate = new Date('2024-01-15T12:00:00.000Z');
    const result = parseDateByMethod('search_result', {
      searchResultText: '3時間前',
      referenceDate,
    });
    expect(result.date).not.toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('apiメソッドでAPIレスポンスをパースする', () => {
    const result = parseDateByMethod('api', {
      apiResponse: '2024-01-15T10:00:00.000Z',
    });
    expect(result.date).toBe('2024-01-15T10:00:00.000Z');
  });
});

describe('境界条件テスト', () => {
  describe('JST日跨ぎ', () => {
    it('23:59から00:00への日跨ぎを正しく処理する', () => {
      // UTC 14:59 = JST 23:59
      const beforeMidnight = new Date('2024-01-15T14:59:00.000Z');
      // UTC 15:00 = JST 00:00
      const afterMidnight = new Date('2024-01-15T15:00:00.000Z');

      const windowStart = calculateWindowStart(null, afterMidnight);
      const expected = new Date(afterMidnight.getTime() - 24 * 60 * 60 * 1000);

      expect(windowStart.toISOString()).toBe(expected.toISOString());
    });
  });

  describe('月曜日判定', () => {
    it('UTC月曜日を正しく判定する', () => {
      // 2024-01-15はUTCで月曜日
      const monday = new Date('2024-01-15T10:00:00.000Z');
      expect(monday.getDay()).toBe(1);

      const windowStart = calculateWindowStart(null, monday);
      const expected = new Date(monday.getTime() - 72 * 60 * 60 * 1000);
      expect(windowStart.toISOString()).toBe(expected.toISOString());
    });
  });
});
