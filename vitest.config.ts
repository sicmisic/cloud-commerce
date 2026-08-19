import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: [
      'tests/{unit,contract,integration,e2e}/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/cdk.out/**', 'apps/frontend/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**', 'apps/api/src/**', 'apps/workers/src/**'],
      exclude: ['**/index.ts', '**/*.d.ts', '**/*.test.ts', 'infrastructure/**'],
    },
    testTimeout: 15_000,
  },
});
