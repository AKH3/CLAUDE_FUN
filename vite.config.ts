import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repo = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    fs: { allow: [repo] },
    proxy: { '/api': 'http://localhost:4317' },
  },
});
