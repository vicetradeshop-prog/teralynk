#!/usr/bin/env node
/**
 * Compile les processus Electron (main + preload) d'une application du monorepo
 * avec esbuild : bundle CJS unique, dépendances externes (electron, electron-updater).
 *
 * Usage : node scripts/build-electron.mjs <app|admin>
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (target !== 'app' && target !== 'admin') {
  console.error('Usage: build-electron.mjs <app|admin>');
  process.exit(1);
}

const appDir = target === 'app' ? path.join(root, 'apps/teralynk') : path.join(root, 'apps/admin');
const entries = ['electron/main.ts', 'electron/preload.ts'].filter((e) => existsSync(path.join(appDir, e)));

await build({
  entryPoints: entries.map((e) => path.join(appDir, e)),
  outdir: path.join(appDir, 'dist-electron'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron', 'electron-updater', 'yauzl'],
  absWorkingDir: appDir,
  alias: {
    '@teralynk/shared': path.join(root, 'packages/shared/src/index.ts'),
    '@teralynk/shared/node': path.join(root, 'packages/shared/src/node.ts')
  },
  define: { 'process.env.NODE_ENV': '"production"' }
});

// Copie la clé publique de signature à côté du bundle (recherche dev + paquet).
const { copyFileSync } = await import('node:fs');
const pem = path.join(appDir, 'electron', 'signing-public-key.pem');
if (existsSync(pem)) {
  copyFileSync(pem, path.join(appDir, 'dist-electron', 'signing-public-key.pem'));
}
console.log(`[build-electron] ${target} OK`);
