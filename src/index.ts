/**
 * Claude Code Daily Reporter
 * メインエントリーポイント
 *
 * 2-Stage構成 + 3層重複排除による情報収集自動化ツール
 */

import * as path from 'path';
import type { CollectionError, DateMethodConfig } from './types/index.js';

import {
  loadAllConfigs,
  disableSources,
  saveLastSuccessAt,
  getHistoryDbPath,
  getOutputDir,
  validateConfigFiles,
} from './config/loader.js';

import { createDeduplicator, type DeduplicatorOptions } from './deduplicator/index.js';
import { createQueryGenerator } from './query-generator/index.js';
import { createCollector, type CollectionTask } from './collector/index.js';
import {
  generateDailyReport,
  generateSimpleReport,
  saveReport,
  generateReportFilename,
} from './output/markdown.js';

/**
 * 実行オプション
 */
export interface RunOptions {
  /** 実行日付（デフォルト: 今日） */
  date?: Date;
  /** ドライラン（収集をスキップ） */
  dryRun?: boolean;
  /** 詳細ログ */
  verbose?: boolean;
  /** カテゴリ化をスキップ（簡易レポート） */
  skipCategorization?: boolean;
  /** Abort多発ソースを自動で無効化する */
  autoDisableUnstableSources?: boolean;
  /** 無効化後に同一実行内で再収集する */
  rerunAfterDisable?: boolean;
}

/**
 * 実行結果
 */
export interface RunResult {
  success: boolean;
  reportPath?: string;
  stats: {
    collected: number;
    afterDedup: number;
    freshArticles: number;
    executionTimeMs: number;
  };
  errors: string[];
}

/**
 * メイン実行関数
 */
export async function run(options: RunOptions = {}): Promise<RunResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const date = options.date ?? new Date();

  console.log(`[Daily Reporter] Starting report generation for ${date.toISOString().split('T')[0]}`);

  // 設定ファイルの検証
  const configValidation = validateConfigFiles();
  if (!configValidation.valid) {
    return {
      success: false,
      stats: { collected: 0, afterDedup: 0, freshArticles: 0, executionTimeMs: 0 },
      errors: [`Missing config files: ${configValidation.missing.join(', ')}`],
    };
  }

  // 設定を読み込む
  let configs = loadAllConfigs();
  console.log(`[Daily Reporter] Loaded ${configs.sources.sources.length} sources`);

  // クエリ生成
  let queryGenerator = createQueryGenerator(configs.tagSynonyms, configs.queries);
  let queryResult = queryGenerator.generate();
  console.log(`[Daily Reporter] Generated ${queryResult.queries.length} queries`);

  // 収集タスクを構築
  let collector = createCollector({
    sourcesConfig: configs.sources,
    queries: queryResult.queries,
    dateRestrictionDays: queryGenerator.getDateRestrictionDays(),
    dryRun: options.dryRun,
    agentConfig: configs.app.agent,
  });

  let tasks = collector.getAllTasks();
  console.log(`[Daily Reporter] Built ${tasks.length} collection tasks`);

  if (options.dryRun) {
    console.log('[Daily Reporter] Dry run mode - skipping actual collection');
    printTasks(tasks, options.verbose ?? false);
    return {
      success: true,
      stats: { collected: 0, afterDedup: 0, freshArticles: 0, executionTimeMs: Date.now() - startTime },
      errors: [],
    };
  }

  // Stage 1: 情報収集
  console.log('[Daily Reporter] Stage 1: Starting collection...');
  let collectionResult = await collector.collectAll();

  const autoDisableUnstableSources = options.autoDisableUnstableSources ?? true;
  const rerunAfterDisable = options.rerunAfterDisable ?? true;

  if (autoDisableUnstableSources) {
    const unstableSourceIds = findAbortHeavySourceIds(collectionResult.errors);
    if (unstableSourceIds.length > 0) {
      const disabledSourceIds = disableSources(unstableSourceIds);
      if (disabledSourceIds.length > 0) {
        console.log(`[Daily Reporter] Disabled unstable sources: ${disabledSourceIds.join(', ')}`);

        if (rerunAfterDisable) {
          console.log('[Daily Reporter] Reloading configuration after disabling unstable sources...');
          configs = loadAllConfigs();
          console.log(`[Daily Reporter] Loaded ${configs.sources.sources.length} sources`);

          queryGenerator = createQueryGenerator(configs.tagSynonyms, configs.queries);
          queryResult = queryGenerator.generate();
          console.log(`[Daily Reporter] Generated ${queryResult.queries.length} queries`);

          collector = createCollector({
            sourcesConfig: configs.sources,
            queries: queryResult.queries,
            dateRestrictionDays: queryGenerator.getDateRestrictionDays(),
            dryRun: false,
            agentConfig: configs.app.agent,
          });

          tasks = collector.getAllTasks();
          console.log(`[Daily Reporter] Built ${tasks.length} collection tasks`);
          console.log('[Daily Reporter] Stage 1: Re-running collection...');
          collectionResult = await collector.collectAll();
        }
      }
    }
  }

  // Tier別ステータスを集計
  const tierCounts = collector.getSourceCountByTier();
  const tierStatus = {
    tier1: { success: 0, total: tierCounts.tier1 },
    tier2: { success: 0, total: tierCounts.tier2 },
    tier3: { success: 0, total: tierCounts.tier3 },
  };

  for (const source of configs.sources.sources) {
    if (!source.enabled) continue;
    const status = collectionResult.sourcesStatus[source.id];
    if (status === 'success' || status === 'partial') {
      if (source.tier === 1) tierStatus.tier1.success++;
      else if (source.tier === 2) tierStatus.tier2.success++;
      else if (source.tier === 3) tierStatus.tier3.success++;
    }
  }

  console.log(`[Daily Reporter] Collection complete: ${collectionResult.stats.totalArticles} articles`);
  console.log(`[Daily Reporter] Tier status: Tier1 ${tierStatus.tier1.success}/${tierStatus.tier1.total}, Tier2 ${tierStatus.tier2.success}/${tierStatus.tier2.total}, Tier3 ${tierStatus.tier3.success}/${tierStatus.tier3.total}`);

  // 重複排除の設定
  const dedupOptions: DeduplicatorOptions = {
    historyStoreConfig: {
      path: getHistoryDbPath(),
      retentionDays: configs.app.historyRetentionDays ?? 90,
    },
    thresholds: configs.dedupThresholds,
    urlNormalization: {
      removeParams: ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source'],
      normalizeTrailingSlash: true,
      lowercaseHost: true,
    },
    lastSuccessAt: configs.lastSuccessAt,
  };

  const deduplicator = createDeduplicator(dedupOptions);

  // DateMethodマップを作成
  const dateMethodMap = new Map<string, DateMethodConfig>();
  for (const source of configs.sources.sources) {
    if (source.dateMethod) {
      dateMethodMap.set(source.id, {
        type: source.dateMethod,
        selector: source.dateSelector,
        pattern: source.datePattern,
      });
    }
  }

  // Stage 2: 重複排除
  console.log('[Daily Reporter] Stage 2: Deduplication');
  const dedupResult = await deduplicator.deduplicate(
    collectionResult.articles,
    dateMethodMap
  );
  console.log(`[Daily Reporter] After dedup: ${dedupResult.articles.length} articles`);

  // レポート生成
  const outputDir = getOutputDir();
  const reportFilename = generateReportFilename(date);
  const reportPath = path.join(outputDir, reportFilename);

  let reportMarkdown: string;

  if (options.skipCategorization) {
    // 簡易レポート（カテゴリ化なし）
    reportMarkdown = generateSimpleReport(
      dedupResult.articles,
      collectionResult,
      dedupResult,
      date,
      configs.sources.sources
    );
  } else {
    // Stage 2: AI整理（カテゴリ化）
    // TODO: 将来実装 - organizer/prompts.ts の categorizeArticles を使用予定
    // 現時点では簡易レポートを生成（Stage2未実装のため）
    console.log('[Daily Reporter] Note: Stage 2 categorization not yet implemented, using simple report');
    reportMarkdown = generateSimpleReport(
      dedupResult.articles,
      collectionResult,
      dedupResult,
      date,
      configs.sources.sources
    );
  }

  // レポートを保存
  await saveReport(reportMarkdown, reportPath);
  console.log(`[Daily Reporter] Report saved to: ${reportPath}`);

  // 成功時刻を保存
  saveLastSuccessAt(new Date().toISOString());

  // クリーンアップ
  const cleanedCount = deduplicator.cleanup();
  if (cleanedCount > 0) {
    console.log(`[Daily Reporter] Cleaned up ${cleanedCount} old history entries`);
  }

  deduplicator.close();

  const endTime = Date.now();

  return {
    success: true,
    reportPath,
    stats: {
      collected: collectionResult.stats.totalArticles,
      afterDedup: dedupResult.articles.length,
      freshArticles: dedupResult.stats.freshArticles,
      executionTimeMs: endTime - startTime,
    },
    errors,
  };
}

/**
 * Abort多発で無効化対象となるソースIDを抽出する
 */
export function findAbortHeavySourceIds(errors: CollectionError[]): string[] {
  const sourceIds = new Set<string>();

  for (const error of errors) {
    if (error.retryCount < 1) {
      continue;
    }

    const normalizedMessage = error.message.toLowerCase();
    if (
      normalizedMessage.includes('aborted by user') ||
      normalizedMessage.includes('process aborted') ||
      normalizedMessage.includes('operation aborted')
    ) {
      sourceIds.add(error.sourceId);
    }
  }

  return [...sourceIds];
}

/**
 * 収集タスクを表示する
 */
function printTasks(tasks: CollectionTask[], verbose: boolean): void {
  console.log('\n=== Collection Tasks ===\n');

  for (const task of tasks) {
    console.log(`Source: ${task.source.id} (${task.source.name})`);
    console.log(`  Method: ${task.method}`);
    console.log(`  Tier: ${task.source.tier}`);

    if (task.url) {
      console.log(`  URL: ${task.url}`);
    }
    if (task.query) {
      console.log(`  Query: ${task.query}`);
    }

    if (verbose) {
      console.log(`  Prompt:\n${task.prompt.split('\n').map((l) => `    ${l}`).join('\n')}`);
    }

    console.log('');
  }
}

/**
 * CLIエントリーポイント
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const options: RunOptions = {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    skipCategorization: args.includes('--simple'),
    autoDisableUnstableSources: !args.includes('--no-auto-disable'),
    rerunAfterDisable: !args.includes('--no-rerun'),
  };

  // --date オプションの処理
  const dateIndex = args.findIndex((arg) => arg === '--date');
  if (dateIndex !== -1 && args[dateIndex + 1]) {
    const dateStr = args[dateIndex + 1];
    const parsedDate = new Date(dateStr ?? '');
    if (!isNaN(parsedDate.getTime())) {
      options.date = parsedDate;
    }
  }

  try {
    const result = await run(options);

    if (result.success) {
      console.log('\n=== Execution Complete ===');
      console.log(`  Collected: ${result.stats.collected}`);
      console.log(`  After Dedup: ${result.stats.afterDedup}`);
      console.log(`  Fresh Articles: ${result.stats.freshArticles}`);
      console.log(`  Execution Time: ${Math.round(result.stats.executionTimeMs / 1000)}s`);

      if (result.reportPath) {
        console.log(`  Report: ${result.reportPath}`);
      }

      process.exit(0);
    } else {
      console.error('\n=== Execution Failed ===');
      for (const error of result.errors) {
        console.error(`  Error: ${error}`);
      }
      process.exit(2);
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(2);
  }
}

// CLI実行時のみmainを呼び出す
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

// エクスポート
export {
  loadAllConfigs,
  createDeduplicator,
  createQueryGenerator,
  createCollector,
  generateDailyReport,
  generateSimpleReport,
  saveReport,
};
