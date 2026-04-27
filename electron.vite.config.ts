import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main.ts'),
      },
    },
    server: {
      watch: {
        ignored: ['**/data/**', '**/.claude/**', '**/scripts/**', '**/out/**', '**/tools/**', '**/*.db', '**/*.jsonl', '**/agentcraft-julius/**'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        output: {
          entryFileNames: 'preload.js',
        },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwindcss()],
    server: {
      watch: {
        ignored: ['**/data/**', '**/.claude/**', '**/scripts/**', '**/out/**', '**/tools/**', '**/*.db', '**/*.jsonl'],
      },
      hmr: {
        overlay: false,
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
  },
});
