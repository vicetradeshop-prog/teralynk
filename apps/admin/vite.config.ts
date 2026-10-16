import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: [
      // Ordre significatif : le sous-chemin '/node' doit être résolu avant le préfixe parent.
      { find: '@teralynk/shared/node', replacement: path.resolve(__dirname, '../../packages/shared/src/node.ts') },
      { find: '@teralynk/shared', replacement: path.resolve(__dirname, '../../packages/shared/src/index.ts') },
      { find: '@teralynk/ui-styles', replacement: path.resolve(__dirname, '../../packages/ui-styles') },
      { find: '@', replacement: path.resolve(__dirname, 'src') }
    ]
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    port: 5174,
    strictPort: true
  }
});
