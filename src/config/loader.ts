/**
 * 設定読み込みモジュール
 * 各種設定ファイルを読み込み、型安全に提供する
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  SourcesConfig,
  QueriesConfig,
  TagSynonyms,
  DedupThresholds,
  AppConfig,
} from '../types/index.js';

/** 設定ファイルのデフォルトパス */
const CONFIG_DIR = path.resolve(process.cwd(), 'config');
const DATA_DIR = path.resolve(process.cwd(), 'data');

/**
 * 設定ファイルを読み込む
 */
function loadJson<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * ソース設定を読み込む
 */
export function loadSourcesConfig(filePath?: string): SourcesConfig {
  const configPath = filePath ?? path.join(CONFIG_DIR, 'sources.json');
  return loadJson<SourcesConfig>(configPath);
}

/**
 * 指定したソースを無効化して設定ファイルへ保存する
 */
export function disableSources(sourceIds: string[], filePath?: string): string[] {
  const uniqueIds = [...new Set(sourceIds)];
  if (uniqueIds.length === 0) {
    return [];
  }

  const configPath = filePath ?? path.join(CONFIG_DIR, 'sources.json');
  const sourcesConfig = loadJson<SourcesConfig>(configPath);
  const targetIds = new Set(uniqueIds);
  const disabled: string[] = [];

  for (const source of sourcesConfig.sources) {
    if (targetIds.has(source.id) && source.enabled) {
      source.enabled = false;
      disabled.push(source.id);
    }
  }

  if (disabled.length > 0) {
    fs.writeFileSync(configPath, `${JSON.stringify(sourcesConfig, null, 2)}\n`, 'utf-8');
  }

  return disabled;
}

/**
 * クエリ設定を読み込む
 */
export function loadQueriesConfig(filePath?: string): QueriesConfig {
  const configPath = filePath ?? path.join(CONFIG_DIR, 'queries.json');
  return loadJson<QueriesConfig>(configPath);
}

/**
 * タグ同義語辞書を読み込む
 */
export function loadTagSynonyms(filePath?: string): TagSynonyms {
  const configPath = filePath ?? path.join(CONFIG_DIR, 'tag-synonyms.json');
  return loadJson<TagSynonyms>(configPath);
}

/**
 * 重複判定しきい値を読み込む
 */
export function loadDedupThresholds(filePath?: string): DedupThresholds {
  const configPath = filePath ?? path.join(CONFIG_DIR, 'dedup-thresholds.json');
  return loadJson<DedupThresholds>(configPath);
}

/**
 * デフォルト設定を読み込む
 */
export function loadDefaultConfig(filePath?: string): AppConfig {
  const configPath = filePath ?? path.join(CONFIG_DIR, 'default.json');
  return loadJson<AppConfig>(configPath);
}

/**
 * 最終成功実行時刻を読み込む
 */
export function loadLastSuccessAt(): string | null {
  const filePath = path.join(DATA_DIR, 'last_success.json');

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as { lastSuccessAt?: string };
    return data.lastSuccessAt ?? null;
  } catch {
    return null;
  }
}

/**
 * 最終成功実行時刻を保存する
 */
export function saveLastSuccessAt(timestamp: string): void {
  const filePath = path.join(DATA_DIR, 'last_success.json');
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const data = { lastSuccessAt: timestamp };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 全設定を読み込む
 */
export interface AllConfigs {
  sources: SourcesConfig;
  queries: QueriesConfig;
  tagSynonyms: TagSynonyms;
  dedupThresholds: DedupThresholds;
  app: AppConfig;
  lastSuccessAt: string | null;
}

export function loadAllConfigs(): AllConfigs {
  return {
    sources: loadSourcesConfig(),
    queries: loadQueriesConfig(),
    tagSynonyms: loadTagSynonyms(),
    dedupThresholds: loadDedupThresholds(),
    app: loadDefaultConfig(),
    lastSuccessAt: loadLastSuccessAt(),
  };
}

/**
 * データディレクトリのパスを取得する
 */
export function getDataDir(): string {
  return DATA_DIR;
}

/**
 * 設定ディレクトリのパスを取得する
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * 履歴DBのパスを取得する
 */
export function getHistoryDbPath(): string {
  return path.join(DATA_DIR, 'history.db');
}

/**
 * ログディレクトリのパスを取得する
 */
export function getLogsDir(): string {
  return path.resolve(process.cwd(), 'logs');
}

/**
 * 出力ディレクトリのパスを取得する
 */
export function getOutputDir(): string {
  return path.resolve(process.cwd(), 'output', 'daily-reports');
}

/**
 * 設定ファイルの存在を確認する
 */
export function validateConfigFiles(): { valid: boolean; missing: string[] } {
  const requiredFiles = [
    path.join(CONFIG_DIR, 'sources.json'),
    path.join(CONFIG_DIR, 'queries.json'),
    path.join(CONFIG_DIR, 'tag-synonyms.json'),
    path.join(CONFIG_DIR, 'dedup-thresholds.json'),
    path.join(CONFIG_DIR, 'default.json'),
  ];

  const missing: string[] = [];

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      missing.push(filePath);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
