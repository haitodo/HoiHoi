import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Main Vite build configuration:
 * Builds the Side Panel UI (`sidepanel.html`) and Background Service Worker (`background.js`)
 * as standard Manifest V3 ES modules.
 *
 * NOTE: The on-demand Content Script (`content/scanner.js`) MUST be built separately
 * via `vite.content.config.ts` as a self-contained IIFE because `chrome.scripting.executeScript`
 * executes files as classic scripts (top-level ESM `import` statements would throw SyntaxError).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
