import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';

// Plugin to copy static extension files to dist
function copyExtensionFiles() {
  return {
    name: 'copy-extension-files',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');

      // Copy manifest.json
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(distDir, 'manifest.json')
      );

      // Copy icons
      const iconsDistDir = resolve(distDir, 'icons');
      if (!existsSync(iconsDistDir)) mkdirSync(iconsDistDir, { recursive: true });

      const iconsSrcDir = resolve(__dirname, 'icons');
      if (existsSync(iconsSrcDir)) {
        for (const file of readdirSync(iconsSrcDir)) {
          if (file.endsWith('.png')) {
            copyFileSync(resolve(iconsSrcDir, file), resolve(iconsDistDir, file));
          }
        }
      }

      // Copy offscreen document
      const offscreenDistDir = resolve(distDir, 'offscreen');
      if (!existsSync(offscreenDistDir)) mkdirSync(offscreenDistDir, { recursive: true });
      const offscreenSrcDir = resolve(__dirname, 'src/offscreen');
      if (existsSync(offscreenSrcDir)) {
        for (const file of readdirSync(offscreenSrcDir)) {
          copyFileSync(resolve(offscreenSrcDir, file), resolve(offscreenDistDir, file));
        }
      }

      // Copy pdf-parser
      const pdfParserDistDir = resolve(distDir, 'pdf-parser');
      if (!existsSync(pdfParserDistDir)) mkdirSync(pdfParserDistDir, { recursive: true });
      const pdfParserSrcDir = resolve(__dirname, 'src/pdf-parser');
      if (existsSync(pdfParserSrcDir)) {
        for (const file of readdirSync(pdfParserSrcDir)) {
          copyFileSync(resolve(pdfParserSrcDir, file), resolve(pdfParserDistDir, file));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionFiles()],
  root: resolve(__dirname, 'src/side-panel'),
  base: '',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/side-panel'),
    emptyOutDir: true,
  },
});
