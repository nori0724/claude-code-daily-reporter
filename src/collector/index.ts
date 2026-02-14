/**
 * 情報収集モジュール
 * Stage1: WebSearch/WebFetchを使用した情報収集
 */

import type {
  SourceConfig,
  SourcesConfig,
  RawArticle,
  CollectionResult,
  CollectionError,
  GeneratedQuery,
  AgentConfig,
} from '../types/index.js';

import {
  buildWebFetchPrompt,
  buildWebSearchPrompt,
  buildTwitterSearchPrompt,
  buildStrictJsonRepairPrompt,
  parseCollectionResult,
  type ParseResult,
} from './prompts.js';
import {
  executeWebFetch,
  executeWebSearch,
  type ExecutorOptions,
} from './sdk-executor.js';

// Re-export prompts
export * from './prompts.js';
export * from './sdk-executor.js';

/**
 * 収集オプション
 */
export interface CollectorOptions {
  /** ソース設定 */
  sourcesConfig: SourcesConfig;
  /** 生成されたクエリ */
  queries: GeneratedQuery[];
  /** 日付制限日数 */
  dateRestrictionDays?: number | null;
  /** 並行処理数 */
  maxConcurrency?: number;
  /** タイムアウト（ms） */
  timeout?: number;
  /** ドライラン（プロンプト生成のみ） */
  dryRun?: boolean;
  /** Agent実行設定 */
  agentConfig?: AgentConfig;
}

/**
 * ソースごとの収集タスク
 */
export interface CollectionTask {
  source: SourceConfig;
  prompt: string;
  method: 'WebFetch' | 'WebSearch';
  url?: string;
  query?: string;
}

/**
 * Collectorクラス
 */
export class Collector {
  private sourcesConfig: SourcesConfig;
  private queries: GeneratedQuery[];
  private dateRestrictionDays: number | null;
  private maxConcurrency: number;
  private timeout: number;
  private dryRun: boolean;
  private agentConfig?: AgentConfig;

  constructor(options: CollectorOptions) {
    this.sourcesConfig = options.sourcesConfig;
    this.queries = options.queries;
    this.dateRestrictionDays = options.dateRestrictionDays ?? null;
    this.maxConcurrency = options.maxConcurrency ?? options.sourcesConfig.rateControl.maxConcurrency;
    this.timeout = options.timeout ?? options.sourcesConfig.rateControl.defaultTimeout;
    this.dryRun = options.dryRun ?? false;
    this.agentConfig = options.agentConfig;
  }

  /**
   * 全ソースから情報を収集する
   */
  async collectAll(): Promise<CollectionResult> {
    const startTime = Date.now();
    const enabledSources = this.sourcesConfig.sources.filter((s) => s.enabled);

    // ソースをTierでグループ化
    const tier1Sources = enabledSources.filter((s) => s.tier === 1);
    const tier2Sources = enabledSources.filter((s) => s.tier === 2);
    const tier3Sources = enabledSources.filter((s) => s.tier === 3);

    const allArticles: RawArticle[] = [];
    const errors: CollectionError[] = [];
    const sourcesStatus: Record<string, 'success' | 'partial' | 'failed'> = {};

    // Tier 1を優先的に処理
    const tier1Results = await this.collectSources(tier1Sources);
    allArticles.push(...tier1Results.articles);
    errors.push(...tier1Results.errors);
    Object.assign(sourcesStatus, tier1Results.status);

    // Tier 2を処理
    const tier2Results = await this.collectSources(tier2Sources);
    allArticles.push(...tier2Results.articles);
    errors.push(...tier2Results.errors);
    Object.assign(sourcesStatus, tier2Results.status);

    // Tier 3（best-effort）を処理
    const tier3Results = await this.collectSources(tier3Sources);
    allArticles.push(...tier3Results.articles);
    // Tier 3のエラーも記録する（警告レベル、致命的ではない）
    for (const error of tier3Results.errors) {
      errors.push({ ...error, errorType: error.errorType ?? 'unknown' });
    }
    Object.assign(sourcesStatus, tier3Results.status);

    const endTime = Date.now();

    return {
      articles: allArticles,
      errors,
      sourcesStatus,
      stats: {
        totalSources: enabledSources.length,
        successfulSources: Object.values(sourcesStatus).filter((s) => s === 'success').length,
        partialSources: Object.values(sourcesStatus).filter((s) => s === 'partial').length,
        failedSources: Object.values(sourcesStatus).filter((s) => s === 'failed').length,
        totalArticles: allArticles.length,
        executionTimeMs: endTime - startTime,
      },
    };
  }

  /**
   * 指定されたソースから情報を収集する
   */
  private async collectSources(sources: SourceConfig[]): Promise<{
    articles: RawArticle[];
    errors: CollectionError[];
    status: Record<string, 'success' | 'partial' | 'failed'>;
  }> {
    const articles: RawArticle[] = [];
    const errors: CollectionError[] = [];
    const status: Record<string, 'success' | 'partial' | 'failed'> = {};

    // 並行処理（maxConcurrencyで制限）
    const chunks = this.chunkArray(sources, this.maxConcurrency);

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map((source) => this.collectFromSource(source))
      );

      for (let i = 0; i < results.length; i++) {
        const source = chunk[i];
        const result = results[i];

        if (!source) continue;

        if (result?.status === 'fulfilled') {
          articles.push(...result.value.articles);
          if (result.value.error) {
            errors.push(result.value.error);
            status[source.id] = 'partial';
          } else {
            status[source.id] = 'success';
          }
        } else if (result?.status === 'rejected') {
          const errorMessage = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
          errors.push({
            sourceId: source.id,
            errorType: 'unknown',
            message: errorMessage,
            timestamp: new Date().toISOString(),
            retryCount: 0,
          });
          status[source.id] = 'failed';
        }
      }
    }

    return { articles, errors, status };
  }

  /**
   * 単一ソースから情報を収集する
   */
  async collectFromSource(source: SourceConfig): Promise<{
    articles: RawArticle[];
    error?: CollectionError;
  }> {
    const task = this.buildTask(source);

    if (this.dryRun) {
      // ドライランの場合はプロンプトのみを返す
      console.log(`[DryRun] Source: ${source.id}`);
      console.log(`[DryRun] Method: ${task.method}`);
      console.log(`[DryRun] Prompt: ${task.prompt.substring(0, 200)}...`);
      return { articles: [] };
    }

    // SDK Executorを使用して実際の収集を行う
    const executorOptions: ExecutorOptions = {
      rateControl: this.sourcesConfig.rateControl,
      model: this.agentConfig?.model,
      maxTurns: this.agentConfig?.maxTurns,
      permissionMode: this.agentConfig?.permissionMode,
      timeout: this.agentConfig?.timeout,
    };

    let result;
    if (task.method === 'WebFetch' && task.url) {
      console.log(`[Collector] Executing WebFetch for ${source.id}: ${task.url}`);
      result = await executeWebFetch(task.url, task.prompt, source, executorOptions);
    } else if (task.method === 'WebSearch' && task.query) {
      console.log(`[Collector] Executing WebSearch for ${source.id}: ${task.query}`);
      result = await executeWebSearch(task.query, task.prompt, source, executorOptions);
    } else {
      return {
        articles: [],
        error: {
          sourceId: source.id,
          errorType: 'unknown',
          message: 'Invalid task configuration: missing url or query',
          timestamp: new Date().toISOString(),
          retryCount: 0,
        },
      };
    }

    if (!result.success) {
      console.log(`[Collector] Failed to collect from ${source.id}: ${result.error?.message}`);
      return { articles: [], error: result.error };
    }

    // 収集結果をパース
    const parseResult = this.parseResult(result.content, source.id);
    console.log(`[Collector] Collected ${parseResult.articles.length} articles from ${source.id}`);

    // パースエラーがある場合はpartialステータスとして扱う
    if (parseResult.parseError) {
      const repairedParseResult = await this.retryStrictJsonRepairIfNeeded(
        source,
        task,
        result.content,
        executorOptions
      );

      if (repairedParseResult && !repairedParseResult.parseError) {
        return { articles: repairedParseResult.articles };
      }

      const finalParseResult = repairedParseResult ?? parseResult;
      const finalParseError = finalParseResult.parseError ?? parseResult.parseError ?? 'Unknown parse error';
      console.log(`[Collector] Parse warning for ${source.id}: ${finalParseError}`);
      if (finalParseResult.rawPreview) {
        console.log(`[Collector] Parse raw preview for ${source.id}: ${finalParseResult.rawPreview}`);
      }
      return {
        articles: finalParseResult.articles,
        error: {
          sourceId: source.id,
          errorType: 'parse',
          message: finalParseError,
          timestamp: new Date().toISOString(),
          retryCount: 0,
        },
      };
    }

    return { articles: parseResult.articles };
  }

  /**
   * 収集タスクを構築する
   */
  buildTask(source: SourceConfig): CollectionTask {
    let prompt: string;
    let method: 'WebFetch' | 'WebSearch';
    let url: string | undefined;
    let query: string | undefined;

    if (source.collectMethod === 'WebFetch') {
      prompt = buildWebFetchPrompt(source);
      method = 'WebFetch';
      url = source.url;
    } else if (source.id === 'twitter') {
      prompt = buildTwitterSearchPrompt(source, this.queries);
      method = 'WebSearch';
      query = this.buildTwitterQuery(source);
    } else {
      const sourceQueries = this.getQueriesForSource();
      prompt = buildWebSearchPrompt(source, sourceQueries, this.dateRestrictionDays);
      method = 'WebSearch';
      query = this.buildSearchQuery(source, sourceQueries);
    }

    return { source, prompt, method, url, query };
  }

  /**
   * 全ソースの収集タスクを取得する
   */
  getAllTasks(): CollectionTask[] {
    const enabledSources = this.sourcesConfig.sources.filter((s) => s.enabled);
    return enabledSources.map((source) => this.buildTask(source));
  }

  /**
   * ソースに割り当てるクエリを取得する
   */
  private getQueriesForSource(): GeneratedQuery[] {
    const maxPerSource = 5; // デフォルト値
    const selectedGroups = new Set<string>();
    const result: GeneratedQuery[] = [];

    for (const query of this.queries) {
      if (result.length >= maxPerSource) break;
      if (!selectedGroups.has(query.groupId)) {
        selectedGroups.add(query.groupId);
        result.push(query);
      }
    }

    return result;
  }

  /**
   * Twitter検索クエリを構築する
   */
  private buildTwitterQuery(source: SourceConfig): string {
    const accounts = source.accounts ?? [];
    const fromAccounts = accounts.map((a) => `from:${a}`).join(' OR ');
    const keywords = this.queries.slice(0, 3).map((q) => q.query).join(' OR ');
    return `(${fromAccounts}) (${keywords})`;
  }

  /**
   * 検索クエリを構築する
   */
  private buildSearchQuery(source: SourceConfig, queries: GeneratedQuery[]): string {
    const siteQuery = source.query ?? '';
    const keywords = queries.map((q) => q.query).join(' ');
    return `${siteQuery} ${keywords}`.trim();
  }

  /**
   * 収集結果をパースする
   */
  parseResult(result: string, sourceId: string): ParseResult {
    return parseCollectionResult(result, sourceId);
  }

  /**
   * Anthropic向けにJSON整形の再取得を1回だけ試みる
   */
  private async retryStrictJsonRepairIfNeeded(
    source: SourceConfig,
    task: CollectionTask,
    rawContent: string,
    executorOptions: ExecutorOptions
  ): Promise<ParseResult | undefined> {
    if (source.id !== 'anthropic_blog' || task.method !== 'WebFetch' || !task.url) {
      return undefined;
    }

    console.log('[Collector] Retrying anthropic_blog with strict JSON repair prompt');
    const repairPrompt = buildStrictJsonRepairPrompt(source, rawContent);
    const repairResult = await executeWebFetch(task.url, repairPrompt, source, executorOptions);

    if (!repairResult.success) {
      return {
        articles: [],
        parseError: `JSON repair execution failed: ${repairResult.error?.message ?? 'unknown error'}`,
      };
    }

    const repairedParse = this.parseResult(repairResult.content, source.id);
    console.log(`[Collector] JSON repair collected ${repairedParse.articles.length} articles from ${source.id}`);

    if (repairedParse.parseError) {
      return {
        ...repairedParse,
        parseError: `JSON repair failed: ${repairedParse.parseError}`,
      };
    }

    return repairedParse;
  }

  /**
   * 配列をチャンクに分割する
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * ソース設定を取得する
   */
  getSourceConfig(sourceId: string): SourceConfig | undefined {
    return this.sourcesConfig.sources.find((s) => s.id === sourceId);
  }

  /**
   * 有効なソース一覧を取得する
   */
  getEnabledSources(): SourceConfig[] {
    return this.sourcesConfig.sources.filter((s) => s.enabled);
  }

  /**
   * Tier別ソース数を取得する
   */
  getSourceCountByTier(): { tier1: number; tier2: number; tier3: number } {
    const sources = this.getEnabledSources();
    return {
      tier1: sources.filter((s) => s.tier === 1).length,
      tier2: sources.filter((s) => s.tier === 2).length,
      tier3: sources.filter((s) => s.tier === 3).length,
    };
  }
}

/**
 * Collectorのファクトリ関数
 */
export function createCollector(options: CollectorOptions): Collector {
  return new Collector(options);
}
