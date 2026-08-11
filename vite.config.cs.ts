import { defineConfig } from 'vite';
import { resolve } from 'path';

// Content script build — single self-contained file
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content-script/index.ts'),
      name: 'contentScript',
      formats: ['iife'],
      fileName: () => 'content-script.js',
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
