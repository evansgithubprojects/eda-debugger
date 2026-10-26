import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Use the packages' sources directly so the demo needs no build step.
export default defineConfig({
  resolve: {
    alias: {
      '@eda-debugger/core': src('../../../packages/core/src/index.ts'),
      '@eda-debugger/adapter-dom': src('../../../packages/adapter-dom/src/index.ts'),
    },
  },
  server: { port: 5174 },
});
