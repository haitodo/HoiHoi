import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Standalone IIFE build for the programmatically injected Content Script (`dist/content/scanner.js`).
 * Runs AFTER `vite build` with `emptyOutDir: false` so `dist/` retains `sidepanel.html`,
 * `background.js`, and `manifest.json`.
 */
export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    lib: {
      entry: resolve(__dirname, 'src/content/scanner.ts'),
      name: 'WicContentScanner',
      formats: ['iife'],
      fileName: () => 'content/scanner.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
