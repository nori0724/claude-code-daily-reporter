import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * 監視テスト用Vitest設定
 *
 * 非決定的テスト（夜間実行用）
 * - KPI監視
 * - E2Eフロー検証
 */
export default defineConfig({
  test: {
    include: ['tests/monitoring/**/*.test.ts'],
    exclude: [],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
    },
    testTimeout: 60000,
    hookTimeout: 60000,
    globals: true,
    // 監視テストはCI環境では実行しない
    // 夜間のcronジョブで実行することを想定
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
