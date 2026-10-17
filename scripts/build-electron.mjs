#!/usr/bin/env node
/**
 * Compile les processus Electron (main + preload) d'une application du monorepo
 * avec esbuild : bundle CJS unique, dépendances externes (electron, electron-updater).
 *
 * Usage : node scripts/build-electron.mjs <app|admin>
 */
import { build } from 'esbuild';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (target !== 'app' && target !== 'admin') {
  console.error('Usage: build-electron.mjs <app|admin>');
  process.exit(1);
}

const appDir = target === 'app' ? path.join(root, 'apps/teralynk') : path.join(root, 'apps/admin');

// Icône auto-réparatrice : si build/icon.png manque (dossiers exclus de certains
// snapshots/stockages), on le restaure depuis la source canonique assets/logo-teralynk.png.
function ensureIcon(appDir) {
  const icon = path.join(appDir, 'build', 'icon.png');
  const canonical = path.join(root, 'assets', 'logo-teralynk.png');
  if (!existsSync(icon) && existsSync(canonical)) {
    mkdirSync(path.dirname(icon), { recursive: true });
    copyFileSync(canonical, icon);
    console.log(`[build-electron] icône restaurée : ${path.relative(root, icon)}`);
  }
}
ensureIcon(appDir);
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
const pem = path.join(appDir, 'electron', 'signing-public-key.pem');
if (existsSync(pem)) {
  copyFileSync(pem, path.join(appDir, 'dist-electron', 'signing-public-key.pem'));
}
console.log(`[build-electron] ${target} OK`);
