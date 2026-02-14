/**
 * SQLite履歴ストアモジュール
 * Layer 1/Layer 2重複排除のための履歴管理を提供
 */

import Database from 'better-sqlite3';
import type { HistoryEntry, DateConfidence } from '../types/index.js';

export interface HistoryStoreConfig {
  /** データベースファイルのパス */
  path: string;
  /** 履歴保持日数（デフォルト90日） */
  retentionDays: number;
}

export interface HistoryStoreStats {
  totalEntries: number;
  oldestEntry: string | null;
  newestEntry: string | null;
  entriesBySource: Record<string, number>;
}

/**
 * SQLite履歴ストアクラス
 */
export class HistoryStore {
  private db: Database.Database;
  private config: HistoryStoreConfig;

  constructor(config: HistoryStoreConfig) {
    this.config = config;
    this.db = new Database(config.path);
    this.initialize();
  }

  /**
   * データベースを初期化する
   */
  private initialize(): void {
    // WALモードを有効化（パフォーマンス向上）
    this.db.pragma('journal_mode = WAL');

    // テーブル作成
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        normalized_url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        published_at TEXT,
        date_confidence TEXT CHECK(date_confidence IN ('high', 'medium', 'low', 'unknown')),
        source TEXT NOT NULL,
        title_hash TEXT,
        content_hash TEXT
      )
    `);

    // インデックス作成
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_normalized_url ON history(normalized_url);
      CREATE INDEX IF NOT EXISTS idx_first_seen_at ON history(first_seen_at);
      CREATE INDEX IF NOT EXISTS idx_published_at ON history(published_at);
      CREATE INDEX IF NOT EXISTS idx_source ON history(source);
      CREATE INDEX IF NOT EXISTS idx_title_hash ON history(title_hash);
    `);
  }

  /**
   * 正規化URLで履歴を検索する（Layer 1: 厳密一致）
   * @param normalizedUrl - 正規化済みURL
   * @returns 履歴エントリ（存在しない場合はnull）
   */
  findByNormalizedUrl(normalizedUrl: string): HistoryEntry | null {
    const stmt = this.db.prepare(`
      SELECT * FROM history WHERE normalized_url = ?
    `);
    const row = stmt.get(normalizedUrl) as HistoryRow | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  /**
   * 複数の正規化URLで一括検索する
   * @param normalizedUrls - 正規化済みURLの配列
   * @returns 存在するURLのSet
   */
  findExistingUrls(normalizedUrls: string[]): Set<string> {
    if (normalizedUrls.length === 0) return new Set();

    const placeholders = normalizedUrls.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT normalized_url FROM history WHERE normalized_url IN (${placeholders})
    `);
    const rows = stmt.all(...normalizedUrls) as Array<{ normalized_url: string }>;
    return new Set(rows.map((row) => row.normalized_url));
  }

  /**
   * タイトルハッシュで検索する（Layer 3: あいまい一致の高速化）
   * @param titleHash - タイトルのハッシュ値
   * @returns 一致する履歴エントリの配列
   */
  findByTitleHash(titleHash: string): HistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM history WHERE title_hash = ?
    `);
    const rows = stmt.all(titleHash) as HistoryRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * 期間内の履歴を取得する
   * @param since - 開始日時（ISO 8601）
   * @param until - 終了日時（ISO 8601、オプション）
   * @returns 履歴エントリの配列
   */
  findByDateRange(since: string, until?: string): HistoryEntry[] {
    let query = 'SELECT * FROM history WHERE first_seen_at >= ?';
    const params: string[] = [since];

    if (until) {
      query += ' AND first_seen_at < ?';
      params.push(until);
    }

    query += ' ORDER BY first_seen_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as HistoryRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * 履歴エントリを追加または更新する
   * @param entry - 履歴エントリ
   * @returns 追加/更新されたエントリ
   */
  upsert(entry: Omit<HistoryEntry, 'id'>): HistoryEntry {
    const existing = this.findByNormalizedUrl(entry.normalizedUrl);

    if (existing) {
      // 既存エントリの更新（last_seen_atを更新）
      const stmt = this.db.prepare(`
        UPDATE history SET
          last_seen_at = ?,
          published_at = COALESCE(?, published_at),
          date_confidence = COALESCE(?, date_confidence),
          title_hash = COALESCE(?, title_hash),
          content_hash = COALESCE(?, content_hash)
        WHERE normalized_url = ?
      `);
      stmt.run(
        entry.lastSeenAt,
        entry.publishedAt,
        entry.dateConfidence,
        entry.titleHash,
        entry.contentHash,
        entry.normalizedUrl
      );

      return { ...existing, lastSeenAt: entry.lastSeenAt };
    } else {
      // 新規エントリの追加
      const stmt = this.db.prepare(`
        INSERT INTO history (
          url, normalized_url, title, first_seen_at, last_seen_at,
          published_at, date_confidence, source, title_hash, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        entry.url,
        entry.normalizedUrl,
        entry.title,
        entry.firstSeenAt,
        entry.lastSeenAt,
        entry.publishedAt ?? null,
        entry.dateConfidence,
        entry.source,
        entry.titleHash ?? null,
        entry.contentHash ?? null
      );

      return { ...entry, id: Number(result.lastInsertRowid) };
    }
  }

  /**
   * 複数の履歴エントリを一括追加する（トランザクション使用）
   * @param entries - 履歴エントリの配列
   * @returns 追加されたエントリの配列
   */
  bulkUpsert(entries: Array<Omit<HistoryEntry, 'id'>>): HistoryEntry[] {
    const results: HistoryEntry[] = [];
    const transaction = this.db.transaction(() => {
      for (const entry of entries) {
        results.push(this.upsert(entry));
      }
    });
    transaction();
    return results;
  }

  /**
   * 保持期間を超えた古い履歴を削除する
   * @param beforeDate - この日付より前の履歴を削除（ISO 8601）
   * @returns 削除された件数
   */
  cleanup(beforeDate?: string): number {
    const cutoffDate =
      beforeDate ?? this.calculateCutoffDate(this.config.retentionDays);

    const stmt = this.db.prepare(`
      DELETE FROM history WHERE first_seen_at < ?
    `);
    const result = stmt.run(cutoffDate);
    return result.changes;
  }

  /**
   * 統計情報を取得する
   * @returns 統計情報
   */
  getStats(): HistoryStoreStats {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM history');
    const total = (totalStmt.get() as { count: number }).count;

    const oldestStmt = this.db.prepare(
      'SELECT MIN(first_seen_at) as oldest FROM history'
    );
    const oldest = (oldestStmt.get() as { oldest: string | null }).oldest;

    const newestStmt = this.db.prepare(
      'SELECT MAX(first_seen_at) as newest FROM history'
    );
    const newest = (newestStmt.get() as { newest: string | null }).newest;

    const bySourceStmt = this.db.prepare(
      'SELECT source, COUNT(*) as count FROM history GROUP BY source'
    );
    const bySource = bySourceStmt.all() as Array<{ source: string; count: number }>;
    const entriesBySource: Record<string, number> = {};
    for (const row of bySource) {
      entriesBySource[row.source] = row.count;
    }

    return {
      totalEntries: total,
      oldestEntry: oldest,
      newestEntry: newest,
      entriesBySource,
    };
  }

  /**
   * 再掲検知: first_seen_atとlast_seen_atの差が指定日数以上のエントリを取得
   * @param daysDiff - 日数差の閾値
   * @returns 再掲の可能性があるエントリ
   */
  findPotentialReposts(daysDiff: number = 7): HistoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM history
      WHERE julianday(last_seen_at) - julianday(first_seen_at) >= ?
      ORDER BY last_seen_at DESC
    `);
    const rows = stmt.all(daysDiff) as HistoryRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * データベースを閉じる
   */
  close(): void {
    this.db.close();
  }

  /**
   * 保持期間のカットオフ日付を計算する（JST）
   */
  private calculateCutoffDate(retentionDays: number): string {
    const now = new Date();
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    return cutoff.toISOString();
  }

  /**
   * データベース行を履歴エントリに変換する
   */
  private rowToEntry(row: HistoryRow): HistoryEntry {
    return {
      id: row.id,
      url: row.url,
      normalizedUrl: row.normalized_url,
      title: row.title,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      publishedAt: row.published_at ?? undefined,
      dateConfidence: row.date_confidence as DateConfidence,
      source: row.source,
      titleHash: row.title_hash ?? undefined,
      contentHash: row.content_hash ?? undefined,
    };
  }
}

/** データベース行の型定義 */
interface HistoryRow {
  id: number;
  url: string;
  normalized_url: string;
  title: string;
  first_seen_at: string;
  last_seen_at: string;
  published_at: string | null;
  date_confidence: string;
  source: string;
  title_hash: string | null;
  content_hash: string | null;
}

/**
 * 履歴ストアのファクトリ関数
 * @param config - 設定
 * @returns HistoryStoreインスタンス
 */
export function createHistoryStore(config: HistoryStoreConfig): HistoryStore {
  return new HistoryStore(config);
}
