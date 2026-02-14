/**
 * Claude Agent SDK Executor
 * WebFetch/WebSearch ツールの実行とリトライ処理を提供
 */

import { query, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  RateControlConfig,
  CollectionError,
  SourceConfig,
  SourceTier,
  AgentConfig,
} from '../types/index.js';

/**
 * URLの基本的なバリデーション
 */
function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * SDK実行結果
 */
export interface ExecutionResult {
  success: boolean;
  content: string;
  error?: CollectionError;
}

/**
 * SDK実行オプション
 */
export interface ExecutorOptions {
  rateControl: RateControlConfig;
  model?: string;
  maxTurns?: number;
  permissionMode?: AgentConfig['permissionMode'];
  timeout?: number;
}

/**
 * WebFetch ツールを実行する
 */
export async function executeWebFetch(
  url: string,
  prompt: string,
  source: SourceConfig,
  options: ExecutorOptions
): Promise<ExecutionResult> {
  // URLバリデーション
  if (!validateUrl(url)) {
    return {
      success: false,
      content: '',
      error: {
        sourceId: source.id,
        errorType: 'parse',
        message: `Invalid URL: ${url}`,
        timestamp: new Date().toISOString(),
        retryCount: 0,
      },
    };
  }

  const sourceRateConfig = getSourceRateConfig(source.id, options.rateControl);
  const maxRetries = getRetriesByTier(source.tier, sourceRateConfig.maxRetries);
  const timeout = Math.max(sourceRateConfig.timeout, options.timeout ?? 0);

  return executeWithRetry(
    () => invokeSDK(
      `Use the WebFetch tool to fetch content from the following URL.

URL: ${url}

${prompt}`,
      options,
      timeout,
      ['WebFetch']
    ),
    source.id,
    maxRetries,
    sourceRateConfig.retryInterval
  );
}

/**
 * WebSearch ツールを実行する
 */
export async function executeWebSearch(
  searchQuery: string,
  prompt: string,
  source: SourceConfig,
  options: ExecutorOptions
): Promise<ExecutionResult> {
  const sourceRateConfig = getSourceRateConfig(source.id, options.rateControl);
  const maxRetries = getRetriesByTier(source.tier, sourceRateConfig.maxRetries);
  const timeout = Math.max(sourceRateConfig.timeout, options.timeout ?? 0);

  return executeWithRetry(
    () => invokeSDK(
      `Use the WebSearch tool to search for information.

Search Query: ${searchQuery}

${prompt}`,
      options,
      timeout,
      ['WebSearch']
    ),
    source.id,
    maxRetries,
    sourceRateConfig.retryInterval
  );
}

/**
 * ソースのレート制御設定を取得する
 */
function getSourceRateConfig(
  sourceId: string,
  rateControl: RateControlConfig
): {
  timeout: number;
  retryInterval: number;
  maxRetries: number;
} {
  const perSource = rateControl.perSource[sourceId];
  return {
    timeout: perSource?.timeout ?? rateControl.defaultTimeout,
    retryInterval: perSource?.retryInterval ?? rateControl.defaultRetryInterval,
    maxRetries: perSource?.maxRetries ?? rateControl.defaultMaxRetries,
  };
}

/**
 * Tier に基づいてリトライ回数を決定する
 * - Tier 1: 最低3回リトライ（高信頼ソース）
 * - Tier 2: 最低1回リトライ（標準ソース）
 * - Tier 3: リトライなし（best-effort）
 */
function getRetriesByTier(tier: SourceTier, configuredRetries: number): number {
  switch (tier) {
    case 1:
      return Math.max(configuredRetries, 3);
    case 2:
      return Math.max(configuredRetries, 1);
    case 3:
      return 0;
  }
}

/**
 * Claude Agent SDK を呼び出す
 */
async function invokeSDK(
  prompt: string,
  options: ExecutorOptions,
  timeout: number,
  tools: string[]
): Promise<string> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeout);

  try {
    const result = query({
      prompt,
      options: {
        abortController,
        model: options.model ?? 'claude-sonnet-4-5-20250929',
        permissionMode: options.permissionMode ?? 'bypassPermissions',
        allowDangerouslySkipPermissions:
          (options.permissionMode ?? 'bypassPermissions') === 'bypassPermissions',
        tools,
        allowedTools: tools,
        maxTurns: options.maxTurns ?? 5,
      },
    });

    let content = '';

    for await (const message of result) {
      if (isSuccessResult(message)) {
        content = message.result;
      }
    }

    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 成功結果かどうかを判定する型ガード
 */
function isSuccessResult(
  message: SDKMessage
): message is SDKResultMessage & { subtype: 'success' } {
  return (
    message.type === 'result' &&
    'subtype' in message &&
    message.subtype === 'success'
  );
}

/**
 * リトライ付きで実行する
 */
async function executeWithRetry(
  fn: () => Promise<string>,
  sourceId: string,
  maxRetries: number,
  retryInterval: number
): Promise<ExecutionResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startedAt = Date.now();
    try {
      const content = await fn();
      return { success: true, content };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[SDK Executor] Attempt ${attempt + 1}/${maxRetries + 1} failed for ${sourceId} after ${elapsedMs}ms: ${lastError.message}`
      );

      if (attempt < maxRetries) {
        await sleep(retryInterval);
      }
    }
  }

  return {
    success: false,
    content: '',
    error: {
      sourceId,
      errorType: classifyError(lastError),
      message: lastError?.message ?? 'Unknown error',
      timestamp: new Date().toISOString(),
      retryCount: maxRetries,
    },
  };
}

/**
 * エラーの種類を分類する
 */
function classifyError(error: Error | null): CollectionError['errorType'] {
  if (!error) return 'unknown';

  const message = error.message.toLowerCase();

  if (
    message.includes('timeout') ||
    message.includes('abort') ||
    message.includes('aborted by user')
  ) {
    return 'timeout';
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('connect')) {
    return 'network';
  }
  if (message.includes('rate') || message.includes('limit') || message.includes('429')) {
    return 'rate_limit';
  }
  if (message.includes('parse') || message.includes('json')) {
    return 'parse';
  }

  return 'unknown';
}

/**
 * 指定時間待機する
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
