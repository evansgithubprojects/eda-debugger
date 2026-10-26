import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@eda-debugger/core': src('./packages/core/src/index.ts'),
      '@eda-debugger/adapter-node': src('./packages/adapter-node/src/index.ts'),
      '@eda-debugger/adapter-dom': src('./packages/adapter-dom/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environmentMatchGlobs: [['packages/adapter-dom/**', 'jsdom']],
  },
});
