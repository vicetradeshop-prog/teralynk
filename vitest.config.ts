import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      // Ordre significatif : le sous-chemin '/node' doit être résolu avant le préfixe parent.
      { find: '@teralynk/shared/node', replacement: path.resolve(__dirname, 'packages/shared/src/node.ts') },
      { find: '@teralynk/shared', replacement: path.resolve(__dirname, 'packages/shared/src/index.ts') },
      { find: '@', replacement: path.resolve(__dirname, 'apps/teralynk/src') }
    ]
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8' }
  }
});
