import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  dts: false,
  sourcemap: true,
  clean: true,
  // Keep build outputs inside the package so `npm publish` includes them.
  outDir: 'dist',
  banner: { js: '#!/usr/bin/env node' },
});
