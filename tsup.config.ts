import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  dts: true,
  splitting: false,
  external: ['pdfjs-dist/legacy/build/pdf.worker.mjs'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
