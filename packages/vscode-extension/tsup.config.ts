import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  sourcemap: true,
  clean: true,
  dts: false,
  // Keep build outputs inside the extension package so `ovsx publish` bundles them.
  outDir: 'dist',
  // VS Code provides the `vscode` module at runtime.
  external: ['vscode'],
});
