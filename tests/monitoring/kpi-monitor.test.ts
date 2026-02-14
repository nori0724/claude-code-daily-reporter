/**
 * KPI監視テスト
 *
 * 非決定的テスト（夜間実行用）
 * - 実行ステータスからKPIを計算
 * - しきい値チェックとアラート
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

interface RunStatusEntry {
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
}

interface KPIResult {
  date: string;
  duplicateRate: number | null; // (collected - afterDedup) / collected
  tier1SuccessRate: number | null;
  tier2SuccessRate: number | null;
  executionTimeMs: number | null;
  status: 'success' | 'partial_failure' | 'fatal_error' | 'skipped';
}

// KPIしきい値
const KPI_THRESHOLDS = {
  maxDuplicateRate: 0.05, // 5%未満
  minTier1SuccessRate: 1.0, // 100%
  minTier2SuccessRate: 0.8, // 80%以上
  maxExecutionTimeMs: 10 * 60 * 1000, // 10分以内
  consecutiveFailureDays: 3, // 連続失敗日数
};

/**
 * run_status.jsonlを読み込む
 */
function loadRunStatus(logDir: string): RunStatusEntry[] {
  const statusPath = path.join(logDir, 'run_status.jsonl');

  if (!fs.existsSync(statusPath)) {
    return [];
  }

  const content = fs.readFileSync(statusPath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());

  return lines.map(line => {
    try {
      return JSON.parse(line) as RunStatusEntry;
    } catch {
      return null;
    }
  }).filter((entry): entry is RunStatusEntry => entry !== null);
}

/**
 * 日付ごとにKPIを計算する
 */
function calculateDailyKPIs(entries: RunStatusEntry[]): Map<string, KPIResult> {
  const dailyKPIs = new Map<string, KPIResult>();

  for (const entry of entries) {
    const date = entry.timestamp.split('T')[0] ?? entry.timestamp;

    // 同じ日の最新エントリを使用
    const existing = dailyKPIs.get(date);
    if (existing && new Date(entry.timestamp) < new Date(existing.date)) {
      continue;
    }

    const kpi: KPIResult = {
      date,
      duplicateRate: null,
      tier1SuccessRate: null,
      tier2SuccessRate: null,
      executionTimeMs: entry.executionTimeMs ?? null,
      status: entry.status,
    };

    if (entry.metrics) {
      const { collected, afterDedup, tier1Success, tier1Total, tier2Success, tier2Total } = entry.metrics;

      if (collected > 0) {
        kpi.duplicateRate = (collected - afterDedup) / collected;
      }

      if (tier1Total > 0) {
        kpi.tier1SuccessRate = tier1Success / tier1Total;
      }

      if (tier2Total > 0) {
        kpi.tier2SuccessRate = tier2Success / tier2Total;
      }
    }

    dailyKPIs.set(date, kpi);
  }

  return dailyKPIs;
}

/**
 * 直近N日のKPI違反をチェックする
 */
function checkConsecutiveFailures(
  dailyKPIs: Map<string, KPIResult>,
  days: number
): { hasFailure: boolean; failedDates: string[]; reasons: string[] } {
  const sortedDates = Array.from(dailyKPIs.keys()).sort().reverse();
  const recentDates = sortedDates.slice(0, days);

  const failedDates: string[] = [];
  const reasons: string[] = [];

  for (const date of recentDates) {
    const kpi = dailyKPIs.get(date);
    if (!kpi) continue;

    const violations: string[] = [];

    if (kpi.status === 'fatal_error') {
      violations.push('fatal_error');
    }

    if (kpi.duplicateRate !== null && kpi.duplicateRate > KPI_THRESHOLDS.maxDuplicateRate) {
      violations.push(`duplicateRate: ${(kpi.duplicateRate * 100).toFixed(1)}% > ${KPI_THRESHOLDS.maxDuplicateRate * 100}%`);
    }

    if (kpi.tier1SuccessRate !== null && kpi.tier1SuccessRate < KPI_THRESHOLDS.minTier1SuccessRate) {
      violations.push(`tier1Success: ${(kpi.tier1SuccessRate * 100).toFixed(0)}% < 100%`);
    }

    if (kpi.tier2SuccessRate !== null && kpi.tier2SuccessRate < KPI_THRESHOLDS.minTier2SuccessRate) {
      violations.push(`tier2Success: ${(kpi.tier2SuccessRate * 100).toFixed(0)}% < 80%`);
    }

    if (kpi.executionTimeMs !== null && kpi.executionTimeMs > KPI_THRESHOLDS.maxExecutionTimeMs) {
      violations.push(`executionTime: ${Math.round(kpi.executionTimeMs / 1000)}s > 600s`);
    }

    if (violations.length > 0) {
      failedDates.push(date);
      reasons.push(`${date}: ${violations.join(', ')}`);
    }
  }

  return {
    hasFailure: failedDates.length >= days,
    failedDates,
    reasons,
  };
}

/**
 * 7日移動平均を計算する
 */
function calculateMovingAverage(
  dailyKPIs: Map<string, KPIResult>,
  field: keyof Pick<KPIResult, 'duplicateRate' | 'tier1SuccessRate' | 'tier2SuccessRate'>,
  days: number = 7
): number | null {
  const sortedDates = Array.from(dailyKPIs.keys()).sort().reverse();
  const recentDates = sortedDates.slice(0, days);

  const values = recentDates
    .map(date => dailyKPIs.get(date)?.[field])
    .filter((v): v is number => v !== null && v !== undefined);

  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe('KPI監視テスト', () => {
  const logDir = path.join(process.cwd(), 'logs');
  let entries: RunStatusEntry[];
  let dailyKPIs: Map<string, KPIResult>;

  beforeAll(() => {
    entries = loadRunStatus(logDir);
    dailyKPIs = calculateDailyKPIs(entries);
  });

  it('run_status.jsonlが存在する（初回実行時はスキップ）', () => {
    // 初回実行時はファイルが存在しない可能性がある
    if (entries.length === 0) {
      console.log('SKIP: No run status entries found (first run?)');
      return;
    }
    expect(entries.length).toBeGreaterThan(0);
  });

  describe('KPIしきい値チェック（データがある場合のみ）', () => {
    it('重複率が5%未満である（7日移動平均）', () => {
      if (dailyKPIs.size === 0) {
        console.log('SKIP: No KPI data available');
        return;
      }

      const avgDuplicateRate = calculateMovingAverage(dailyKPIs, 'duplicateRate');
      if (avgDuplicateRate === null) {
        console.log('SKIP: No duplicate rate data');
        return;
      }

      console.log(`7-day avg duplicate rate: ${(avgDuplicateRate * 100).toFixed(2)}%`);
      expect(avgDuplicateRate).toBeLessThanOrEqual(KPI_THRESHOLDS.maxDuplicateRate);
    });

    it('Tier1取得成功率が100%である', () => {
      if (dailyKPIs.size === 0) {
        console.log('SKIP: No KPI data available');
        return;
      }

      const avgTier1Rate = calculateMovingAverage(dailyKPIs, 'tier1SuccessRate');
      if (avgTier1Rate === null) {
        console.log('SKIP: No Tier1 success rate data');
        return;
      }

      console.log(`7-day avg Tier1 success rate: ${(avgTier1Rate * 100).toFixed(0)}%`);
      expect(avgTier1Rate).toBeGreaterThanOrEqual(KPI_THRESHOLDS.minTier1SuccessRate);
    });

    it('Tier2取得成功率が80%以上である（7日移動平均）', () => {
      if (dailyKPIs.size === 0) {
        console.log('SKIP: No KPI data available');
        return;
      }

      const avgTier2Rate = calculateMovingAverage(dailyKPIs, 'tier2SuccessRate');
      if (avgTier2Rate === null) {
        console.log('SKIP: No Tier2 success rate data');
        return;
      }

      console.log(`7-day avg Tier2 success rate: ${(avgTier2Rate * 100).toFixed(0)}%`);
      expect(avgTier2Rate).toBeGreaterThanOrEqual(KPI_THRESHOLDS.minTier2SuccessRate);
    });
  });

  describe('連続失敗検知', () => {
    it('3日連続でKPI違反がない', () => {
      if (dailyKPIs.size === 0) {
        console.log('SKIP: No KPI data available');
        return;
      }

      const { hasFailure, failedDates, reasons } = checkConsecutiveFailures(
        dailyKPIs,
        KPI_THRESHOLDS.consecutiveFailureDays
      );

      if (reasons.length > 0) {
        console.log('KPI violations found:');
        reasons.forEach(r => console.log(`  - ${r}`));
      }

      expect(hasFailure).toBe(false);
    });
  });

  describe('実行時間チェック', () => {
    it('直近の実行時間が10分以内である', () => {
      if (dailyKPIs.size === 0) {
        console.log('SKIP: No KPI data available');
        return;
      }

      const sortedDates = Array.from(dailyKPIs.keys()).sort().reverse();
      const latestDate = sortedDates[0];
      if (!latestDate) {
        console.log('SKIP: No execution data');
        return;
      }

      const latestKPI = dailyKPIs.get(latestDate);
      if (!latestKPI || latestKPI.executionTimeMs === null) {
        console.log('SKIP: No execution time data');
        return;
      }

      console.log(`Latest execution time: ${Math.round(latestKPI.executionTimeMs / 1000)}s`);
      expect(latestKPI.executionTimeMs).toBeLessThanOrEqual(KPI_THRESHOLDS.maxExecutionTimeMs);
    });
  });
});

/**
 * KPIレポートを生成するユーティリティ（CLI用）
 */
export function generateKPIReport(logDir: string): string {
  const entries = loadRunStatus(logDir);
  const dailyKPIs = calculateDailyKPIs(entries);

  if (dailyKPIs.size === 0) {
    return 'No KPI data available.';
  }

  const sortedDates = Array.from(dailyKPIs.keys()).sort().reverse();
  const recent7 = sortedDates.slice(0, 7);

  let report = '=== KPI Report ===\n\n';

  // 7日移動平均
  const avgDuplicateRate = calculateMovingAverage(dailyKPIs, 'duplicateRate');
  const avgTier1Rate = calculateMovingAverage(dailyKPIs, 'tier1SuccessRate');
  const avgTier2Rate = calculateMovingAverage(dailyKPIs, 'tier2SuccessRate');

  report += '7-Day Moving Averages:\n';
  report += `  Duplicate Rate: ${avgDuplicateRate !== null ? (avgDuplicateRate * 100).toFixed(2) + '%' : 'N/A'} (target: <5%)\n`;
  report += `  Tier1 Success:  ${avgTier1Rate !== null ? (avgTier1Rate * 100).toFixed(0) + '%' : 'N/A'} (target: 100%)\n`;
  report += `  Tier2 Success:  ${avgTier2Rate !== null ? (avgTier2Rate * 100).toFixed(0) + '%' : 'N/A'} (target: ≥80%)\n\n`;

  // 日別詳細
  report += 'Daily Details (recent 7 days):\n';
  for (const date of recent7) {
    const kpi = dailyKPIs.get(date);
    if (!kpi) continue;

    const dupRate = kpi.duplicateRate !== null ? (kpi.duplicateRate * 100).toFixed(1) + '%' : 'N/A';
    const t1Rate = kpi.tier1SuccessRate !== null ? (kpi.tier1SuccessRate * 100).toFixed(0) + '%' : 'N/A';
    const t2Rate = kpi.tier2SuccessRate !== null ? (kpi.tier2SuccessRate * 100).toFixed(0) + '%' : 'N/A';
    const execTime = kpi.executionTimeMs !== null ? Math.round(kpi.executionTimeMs / 1000) + 's' : 'N/A';

    report += `  ${date}: dup=${dupRate}, T1=${t1Rate}, T2=${t2Rate}, time=${execTime}, status=${kpi.status}\n`;
  }

  // アラートチェック
  const { hasFailure, reasons } = checkConsecutiveFailures(dailyKPIs, KPI_THRESHOLDS.consecutiveFailureDays);
  if (hasFailure) {
    report += '\n⚠️  ALERT: KPI violations for 3+ consecutive days!\n';
    reasons.forEach(r => report += `  - ${r}\n`);
  } else {
    report += '\n✓ No consecutive KPI violations detected.\n';
  }

  return report;
}
