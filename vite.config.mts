/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import * as path from 'path';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: './node_modules/.vite/clap-app',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@ds': path.resolve(import.meta.dirname, './libs/design-system/src'),
      '@clap/design-system': path.resolve(
        import.meta.dirname,
        './libs/design-system/src/index.ts'
      ),
    },
  },
  server: {
    port: 5173,
    host: 'localhost',
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    visualizer({
      filename: 'dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  build: {
    outDir: './dist/clap-app',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    chunkSizeWarningLimit: 1000,
  },
  test: {
    name: 'clap-app',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**/*'],
  },
}));
