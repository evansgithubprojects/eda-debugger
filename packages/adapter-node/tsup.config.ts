import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/auto.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
});
