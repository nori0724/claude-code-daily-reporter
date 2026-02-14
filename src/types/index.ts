/**
 * 共通型定義
 */

// ============================================
// 記事関連
// ============================================

/** 日付の信頼度 */
export type DateConfidence = 'high' | 'medium' | 'low' | 'unknown';

/** 情報ソースのTier */
export type SourceTier = 1 | 2 | 3;

/** 収集手段 */
export type CollectMethod = 'WebFetch' | 'WebSearch';

/** 日時取得手段 */
export type DateMethod = 'html_meta' | 'html_parse' | 'url_parse' | 'search_result' | 'api';

/** 日付取得ソース（Freshness判定用） */
export type DateSource = 'published_at' | 'url_date' | 'relative_time' | 'first_seen_at';

/** Freshness優先度 */
export type FreshnessPriority = 'high' | 'normal' | 'low';

/** 生の記事データ（Stage1出力） */
export interface RawArticle {
  url: string;
  title: string;
  summary?: string;
  source: string;
  fetchedAt?: string; // ISO 8601
  collectedAt?: string; // ISO 8601（fetchedAtの別名）
  publishedAt?: string; // ISO 8601（記事の公開日時）
  rawContent?: string;
  /** 収集時に取得した日付関連メタ情報（html_meta等で使用） */
  dateMetaContent?: string;
}

/** フィルタ済み記事データ（重複排除後） */
export interface FilteredArticle extends RawArticle {
  normalizedUrl: string;
  isNew: boolean;
  publishedAt?: string; // ISO 8601
  dateConfidence: DateConfidence;
  similarityScore?: number;
  // Freshness判定用フィールド
  dateSource?: DateSource;
  urlDate?: string; // ISO 8601（URLから抽出した日付）
  relativeTimeParsed?: string; // ISO 8601（相対時刻をパースした結果）
  freshnessPriority: FreshnessPriority;
}

/** 整理済み記事データ（Stage2出力） */
export interface OrganizedArticle {
  title: string;
  url: string;
  summary: string;
  source: string;
  relevanceScore: number;
  tags: string[];
  publishedAt?: string;
}

/** カテゴリ別にまとめられた記事群 */
export interface ArticleCategory {
  name: string;
  articles: OrganizedArticle[];
}

/** 最終レポート */
export interface OrganizedReport {
  date: string;
  categories: ArticleCategory[];
  metadata: ReportMetadata;
}

/** レポートのメタデータ */
export interface ReportMetadata {
  totalCollected: number;
  afterDedup: number;
  inReport: number;
  executionTimeMs: number;
  sourcesStatus: SourceStatus[];
  generatedAt: string;
}

/** ソースごとの取得状態 */
export interface SourceStatus {
  sourceId: string;
  tier: SourceTier;
  success: boolean;
  articlesCount: number;
  error?: string;
}

// ============================================
// 履歴DB関連
// ============================================

/** 履歴エントリ */
export interface HistoryEntry {
  id?: number;
  url: string;
  normalizedUrl: string;
  title: string;
  firstSeenAt: string; // ISO 8601
  lastSeenAt: string; // ISO 8601
  publishedAt?: string; // ISO 8601
  dateConfidence: DateConfidence;
  source: string;
  // Layer3高速化用ハッシュ（オプション）
  titleHash?: string;
  contentHash?: string;
}

// ============================================
// 設定関連
// ============================================

/** ソース定義 */
export interface SourceConfig {
  id: string;
  name: string;
  tier: SourceTier;
  enabled: boolean;
  collectMethod: CollectMethod;
  url?: string;
  query?: string;
  accounts?: string[]; // X/Twitter用アカウントリスト
  dateMethod: DateMethod;
  dateSelector?: string;
  datePattern?: string;
  maxArticles: number;
}

/** レート制御設定 */
export interface RateControlConfig {
  maxConcurrency: number;
  defaultTimeout: number;
  defaultRetryInterval: number;
  defaultMaxRetries: number;
  perSource: Record<
    string,
    {
      timeout: number;
      retryInterval: number;
      maxRetries: number;
    }
  >;
}

/** ソース設定全体 */
export interface SourcesConfig {
  sources: SourceConfig[];
  rateControl: RateControlConfig;
}

/** 重複判定しきい値 */
export interface DedupThresholds {
  metric_definitions: {
    jaccard: string;
    levenshtein: string;
  };
  thresholds: Record<
    string,
    {
      jaccard_gte: number;
      levenshtein_lte: number;
    }
  >;
  layer2_fallback: Record<
    string,
    {
      same_domain: number;
      cross_domain: number;
    }
  >;
}

/** タグ同義語辞書 */
export type TagSynonyms = Record<string, string[]>;

/** クエリグループ */
export interface QueryGroup {
  id: string;
  name: string;
  keywords: string[];
  weight: number;
}

/** クエリ設定 */
export interface QueriesConfig {
  queryGroups: QueryGroup[];
  combinedQueries: {
    enabled: boolean;
    maxCombinations: number;
  };
  dateRestriction: {
    enabled: boolean;
    withinDays: number;
  };
  selection: {
    topN: number;
    maxPerSource: number;
  };
  recalculation: {
    interval: 'daily' | 'weekly' | 'monthly';
    basedOn: string;
  };
}

/** アプリケーション全体設定 */
export interface AgentConfig {
  maxTurns: number;
  maxTurnsOrganizer: number;
  permissionMode: 'bypassPermissions' | 'acceptEdits' | 'default';
  model: string;
  timeout: number;
}

/** アプリケーション全体設定 */
export interface AppConfig {
  agent: AgentConfig;
  deduplication: {
    enabled: boolean;
    urlNormalization: {
      removeParams: string[];
      normalizeTrailingSlash: boolean;
      lowercaseHost: boolean;
    };
    historyStore: {
      type: 'sqlite' | 'json';
      path: string;
      retentionDays: number;
    };
  };
  output: {
    directory: string;
    filenameFormat: string;
    includeMetadata: boolean;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    filePattern: string; // e.g., "./logs/YYYY-MM-DD.log"
    runStatusPath: string; // e.g., "./logs/run_status.jsonl"
  };
  /** 履歴保持日数（トップレベル） */
  historyRetentionDays?: number;
}

// ============================================
// 実行状態関連
// ============================================

/** 最終成功実行時刻 */
export interface LastSuccessState {
  lastSuccessAt: string; // ISO 8601
  reportPath: string;
}

/** 収集エラー情報 */
export interface CollectionError {
  sourceId: string;
  errorType: 'timeout' | 'network' | 'parse' | 'rate_limit' | 'unknown';
  message: string;
  timestamp: string;
  retryCount: number;
}

/** 実行ステータス（KPI計測用） */
export interface RunStatus {
  status: 'success' | 'partial_failure' | 'fatal_error' | 'skipped';
  reason?: string;
  timestamp: string;
  executionTimeMs?: number;
  metrics?: {
    collected: number;
    afterDedup: number;
    inReport: number;
    tier1Success: number;
    tier1Total: number;
    tier2Success: number;
    tier2Total: number;
    tier3Success: number;
    tier3Total: number;
  };
  errors?: CollectionError[];
}

// ============================================
// 収集・重複排除結果
// ============================================

/** 収集結果 */
export interface CollectionResult {
  articles: RawArticle[];
  errors: CollectionError[];
  sourcesStatus: Record<string, 'success' | 'partial' | 'failed'>;
  stats: {
    totalSources: number;
    successfulSources: number;
    partialSources: number;
    failedSources: number;
    totalArticles: number;
    executionTimeMs: number;
  };
}

/** 重複排除結果 */
export interface DeduplicationResult {
  articles: FilteredArticle[];
  stats: {
    totalInput: number;
    afterUrlDedup: number;
    afterHistoryDedup: number;
    afterSimilarityDedup: number;
    freshArticles: number;
  };
}

/** 生成されたクエリ */
export interface GeneratedQuery {
  query: string;
  groupId: string;
  groupName: string;
  baseWeight: number;
  finalWeight: number;
  keywords: string[];
}

/** 日付取得方法の設定 */
export interface DateMethodConfig {
  type: DateMethod;
  selector?: string;
  pattern?: string;
}
