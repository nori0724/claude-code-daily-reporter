/**
 * 日付パーサーモジュール
 * 3層日付判定とFreshness判定を提供
 */

import type { DateConfidence, DateSource, FreshnessPriority, DateMethod } from '../types/index.js';

/**
 * 日付解析結果
 */
export interface DateParseResult {
  /** パースされた日付（ISO 8601） */
  date: string | null;
  /** 日付の信頼度 */
  confidence: DateConfidence;
  /** 日付のソース */
  source: DateSource;
  /** 生のテキスト（参考用） */
  rawText?: string;
}

/**
 * Freshness判定結果
 */
export interface FreshnessResult {
  /** 新鮮かどうか */
  isFresh: boolean;
  /** 優先度 */
  priority: FreshnessPriority;
  /** 使用した日付ソース */
  dateSource: DateSource | null;
  /** 判定理由 */
  reason: string;
}

// ============================================
// Layer 1: 厳密判定（メタタグ等から取得）
// ============================================

/**
 * ISO 8601形式の日付文字列をパースする
 * @param dateString - 日付文字列
 * @returns パース結果
 */
export function parseISODate(dateString: string | null | undefined): DateParseResult {
  if (!dateString) {
    return { date: null, confidence: 'unknown', source: 'published_at' };
  }

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return { date: null, confidence: 'unknown', source: 'published_at', rawText: dateString };
    }
    return {
      date: date.toISOString(),
      confidence: 'high',
      source: 'published_at',
      rawText: dateString,
    };
  } catch {
    return { date: null, confidence: 'unknown', source: 'published_at', rawText: dateString };
  }
}

// ============================================
// Layer 2: 準厳密判定（URLから抽出）
// ============================================

/**
 * URLから日付を抽出するパターン
 */
const URL_DATE_PATTERNS = [
  // /2024/01/15/ または /2024-01-15/
  /\/(\d{4})[-\/](\d{2})[-\/](\d{2})/,
  // ?date=2024-01-15 または &date=2024-01-15
  /[?&]date=(\d{4})[-\/](\d{2})[-\/](\d{2})/,
  // /articles/20240115
  /\/articles?\/(\d{4})(\d{2})(\d{2})/,
];

/**
 * URLから日付を抽出する
 * @param url - URL文字列
 * @param pattern - カスタムパターン（オプション）
 * @returns パース結果
 */
export function parseDateFromUrl(url: string, pattern?: string): DateParseResult {
  const patterns = pattern ? [new RegExp(pattern)] : URL_DATE_PATTERNS;

  for (const regex of patterns) {
    const match = url.match(regex);
    if (match) {
      const year = match[1];
      const month = match[2];
      const day = match[3];
      if (!year || !month || !day) continue;
      const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`;

      try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return {
            date: date.toISOString(),
            confidence: 'medium',
            source: 'url_date',
            rawText: `${year}/${month}/${day}`,
          };
        }
      } catch {
        // パースに失敗した場合は次のパターンへ
      }
    }
  }

  return { date: null, confidence: 'unknown', source: 'url_date' };
}

// ============================================
// Layer 3: 推定判定（相対時刻から計算）
// ============================================

/**
 * 相対時刻パターン
 */
const RELATIVE_TIME_PATTERNS = {
  // 日本語
  ja: [
    { pattern: /(\d+)\s*秒前/, unit: 'seconds' },
    { pattern: /(\d+)\s*分前/, unit: 'minutes' },
    { pattern: /(\d+)\s*時間前/, unit: 'hours' },
    { pattern: /(\d+)\s*日前/, unit: 'days' },
    { pattern: /(\d+)\s*週間前/, unit: 'weeks' },
    { pattern: /(\d+)\s*ヶ月前/, unit: 'months' },
    { pattern: /(\d+)\s*か月前/, unit: 'months' },
    { pattern: /昨日/, unit: 'yesterday' },
    { pattern: /今日/, unit: 'today' },
    { pattern: /先週/, unit: 'last_week' },
  ],
  // 英語
  en: [
    { pattern: /(\d+)\s*seconds?\s*ago/i, unit: 'seconds' },
    { pattern: /(\d+)\s*minutes?\s*ago/i, unit: 'minutes' },
    { pattern: /(\d+)\s*hours?\s*ago/i, unit: 'hours' },
    { pattern: /(\d+)\s*days?\s*ago/i, unit: 'days' },
    { pattern: /(\d+)\s*weeks?\s*ago/i, unit: 'weeks' },
    { pattern: /(\d+)\s*months?\s*ago/i, unit: 'months' },
    { pattern: /yesterday/i, unit: 'yesterday' },
    { pattern: /today/i, unit: 'today' },
    { pattern: /last\s*week/i, unit: 'last_week' },
  ],
} as const;

type TimeUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'yesterday' | 'today' | 'last_week';

/**
 * 相対時刻テキストを日付にパースする
 * @param text - 相対時刻テキスト（例: "3時間前", "2 days ago"）
 * @param referenceDate - 基準日時（デフォルトは現在時刻）
 * @returns パース結果
 */
export function parseRelativeTime(text: string, referenceDate: Date = new Date()): DateParseResult {
  // 全パターンを試行
  for (const locale of ['ja', 'en'] as const) {
    for (const { pattern, unit } of RELATIVE_TIME_PATTERNS[locale]) {
      const match = text.match(pattern);
      if (match) {
        const value = match[1] ? parseInt(match[1], 10) : 1;
        const date = calculateDateFromRelative(value, unit, referenceDate);

        if (date) {
          return {
            date: date.toISOString(),
            confidence: 'low',
            source: 'relative_time',
            rawText: text,
          };
        }
      }
    }
  }

  return { date: null, confidence: 'unknown', source: 'relative_time', rawText: text };
}

/**
 * 相対時刻から日付を計算する
 */
function calculateDateFromRelative(
  value: number,
  unit: TimeUnit,
  referenceDate: Date
): Date | null {
  const date = new Date(referenceDate);

  switch (unit) {
    case 'seconds':
      date.setSeconds(date.getSeconds() - value);
      break;
    case 'minutes':
      date.setMinutes(date.getMinutes() - value);
      break;
    case 'hours':
      date.setHours(date.getHours() - value);
      break;
    case 'days':
      date.setDate(date.getDate() - value);
      break;
    case 'weeks':
      date.setDate(date.getDate() - value * 7);
      break;
    case 'months':
      date.setMonth(date.getMonth() - value);
      break;
    case 'yesterday':
      date.setDate(date.getDate() - 1);
      break;
    case 'today':
      // 今日の場合は何もしない
      break;
    case 'last_week':
      date.setDate(date.getDate() - 7);
      break;
    default:
      return null;
  }

  return date;
}

// ============================================
// 統合関数
// ============================================

/**
 * 日付を3層で順番にパースする
 * @param options - パースオプション
 * @returns 最初に成功したパース結果
 */
export function parseDateMultiLayer(options: {
  publishedAt?: string | null;
  url?: string;
  relativeTimeText?: string;
  urlDatePattern?: string;
  referenceDate?: Date;
}): DateParseResult {
  // Layer 1: 厳密判定（published_at）
  if (options.publishedAt) {
    const result = parseISODate(options.publishedAt);
    if (result.date) {
      return result;
    }
  }

  // Layer 2: 準厳密判定（URL）
  if (options.url) {
    const result = parseDateFromUrl(options.url, options.urlDatePattern);
    if (result.date) {
      return result;
    }
  }

  // Layer 3: 推定判定（相対時刻）
  if (options.relativeTimeText) {
    const result = parseRelativeTime(options.relativeTimeText, options.referenceDate);
    if (result.date) {
      return result;
    }
  }

  // すべて失敗
  return { date: null, confidence: 'unknown', source: 'first_seen_at' };
}

// ============================================
// Freshness判定
// ============================================

/**
 * 時間窓の開始時刻を計算する
 * @param lastSuccessAt - 前回成功時刻（ISO 8601）
 * @param now - 現在時刻
 * @returns 時間窓の開始時刻
 */
export function calculateWindowStart(
  lastSuccessAt: string | null,
  now: Date = new Date()
): Date {
  // 月曜日かどうかを判定
  const isMonday = now.getDay() === 1;

  if (lastSuccessAt) {
    const lastSuccess = new Date(lastSuccessAt);

    // 月曜日の場合、72時間（3日）まで遡る
    if (isMonday) {
      const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);
      // lastSuccessAtがthreeDaysAgoより新しい場合はlastSuccessAtを使用
      return lastSuccess > threeDaysAgo ? lastSuccess : threeDaysAgo;
    }

    return lastSuccess;
  }

  // lastSuccessAtがない場合
  if (isMonday) {
    // 月曜日は72時間前
    return new Date(now.getTime() - 72 * 60 * 60 * 1000);
  }

  // デフォルトは24時間前
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

/**
 * 記事の新鮮さを判定する
 * @param options - 判定オプション
 * @returns Freshness判定結果
 */
export function checkFreshness(options: {
  publishedAt?: string | null;
  urlDate?: string | null;
  relativeTimeParsed?: string | null;
  firstSeenAt?: string | null;
  windowStart: Date;
}): FreshnessResult {
  const { publishedAt, urlDate, relativeTimeParsed, firstSeenAt, windowStart } = options;
  const windowStartTime = windowStart.getTime();

  // 優先順位1: published_at
  if (publishedAt) {
    const pubDate = new Date(publishedAt);
    if (!isNaN(pubDate.getTime())) {
      if (pubDate.getTime() >= windowStartTime) {
        return {
          isFresh: true,
          priority: 'high',
          dateSource: 'published_at',
          reason: `Published at ${publishedAt} is within window`,
        };
      } else {
        return {
          isFresh: false,
          priority: 'high',
          dateSource: 'published_at',
          reason: `Published at ${publishedAt} is before window start`,
        };
      }
    }
  }

  // 優先順位2: URL内の日付
  if (urlDate) {
    const date = new Date(urlDate);
    if (!isNaN(date.getTime())) {
      if (date.getTime() >= windowStartTime) {
        return {
          isFresh: true,
          priority: 'normal',
          dateSource: 'url_date',
          reason: `URL date ${urlDate} is within window`,
        };
      } else {
        return {
          isFresh: false,
          priority: 'normal',
          dateSource: 'url_date',
          reason: `URL date ${urlDate} is before window start`,
        };
      }
    }
  }

  // 優先順位3: 相対時刻
  if (relativeTimeParsed) {
    const date = new Date(relativeTimeParsed);
    if (!isNaN(date.getTime())) {
      if (date.getTime() >= windowStartTime) {
        return {
          isFresh: true,
          priority: 'normal',
          dateSource: 'relative_time',
          reason: `Relative time ${relativeTimeParsed} is within window`,
        };
      } else {
        return {
          isFresh: false,
          priority: 'normal',
          dateSource: 'relative_time',
          reason: `Relative time ${relativeTimeParsed} is before window start`,
        };
      }
    }
  }

  // 優先順位4: first_seen_at（日付不明の場合のフォールバック）
  if (firstSeenAt) {
    const date = new Date(firstSeenAt);
    if (!isNaN(date.getTime())) {
      if (date.getTime() >= windowStartTime) {
        return {
          isFresh: true,
          priority: 'low',
          dateSource: 'first_seen_at',
          reason: `First seen at ${firstSeenAt} is within window (fallback)`,
        };
      } else {
        return {
          isFresh: false,
          priority: 'low',
          dateSource: 'first_seen_at',
          reason: `First seen at ${firstSeenAt} is before window start (fallback)`,
        };
      }
    }
  }

  // すべての日付が不明な場合は新鮮と判定（取りこぼし防止）
  return {
    isFresh: true,
    priority: 'low',
    dateSource: null,
    reason: 'All dates unknown, including with low priority',
  };
}

/**
 * DateMethodに基づいて適切な日付パーサーを選択する
 * @param method - 日付取得方法
 * @param options - パースオプション
 * @returns パース結果
 */
export function parseDateByMethod(
  method: DateMethod,
  options: {
    metaContent?: string | null;
    htmlContent?: string;
    url?: string;
    searchResultText?: string;
    apiResponse?: string | null;
    dateSelector?: string;
    datePattern?: string;
    referenceDate?: Date;
  }
): DateParseResult {
  switch (method) {
    case 'html_meta':
    case 'api':
      return parseISODate(options.metaContent ?? options.apiResponse);

    case 'url_parse':
      return options.url
        ? parseDateFromUrl(options.url, options.datePattern)
        : { date: null, confidence: 'unknown', source: 'url_date' };

    case 'html_parse':
    case 'search_result':
      return options.searchResultText ?? options.htmlContent
        ? parseRelativeTime(
            options.searchResultText ?? options.htmlContent ?? '',
            options.referenceDate
          )
        : { date: null, confidence: 'unknown', source: 'relative_time' };

    default:
      return { date: null, confidence: 'unknown', source: 'first_seen_at' };
  }
}
