#!/usr/bin/env node
/**
 * Livraison Teralynk — vérification complète PUIS ZIP source versionné.
 *
 * Usage : node scripts/make-delivery.mjs <version-semver>
 *
 * Étapes (échec = aucun ZIP produit) :
 *   1. Vérification TypeScript des 3 packages (shared, app, admin)
 *   2. Suite de tests automatisés (vitest)
 *   3. Build de Teralynk (renderer Vite + processus Electron)
 *   4. Build de Teralynk Admin (renderer Vite + processus Electron)
 *   5. ZIP complet des sources avec SHA256SUMS.txt + DELIVERY_INFO.txt
 *
 * Le ZIP contient TOUT ce qui est nécessaire pour reconstruire le projet
 * (sources, docs, tests, scripts, package-lock) et RIEN de sensible :
 * node_modules, builds, releases, clés privées et journaux sont exclus.
 */
import { execSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/.test(version)) {
  console.error('Usage : node scripts/make-delivery.mjs <version-semver>   (ex. 1.0.0)');
  process.exit(1);
}

/* ---------------- 0. Synchronisation de la version sur tous les packages ---------------- */

const pkgFiles = [
  'package.json',
  'packages/shared/package.json',
  'packages/ui-styles/package.json',
  'apps/teralynk/package.json',
  'apps/admin/package.json'
];
for (const rel of pkgFiles) {
  const full = path.join(root, rel);
  const pkg = JSON.parse(readFileSync(full, 'utf8'));
  pkg.version = version;
  writeFileSync(full, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}
console.log(`Version ${version} synchronisée sur ${pkgFiles.length} packages.`);

/* ---------------- 1-4. Vérifications obligatoires ---------------- */

const steps = [
  ['Vérification TypeScript (shared + app + admin)', 'npm run typecheck'],
  ['Tests automatisés (vitest)', 'npx vitest run'],
  ['Build Teralynk (renderer + electron)', 'npm run build -w @teralynk/app'],
  ['Build Teralynk Admin (renderer + electron)', 'npm run build -w @teralynk/admin']
];

for (const [label, cmd] of steps) {
  process.stdout.write(`▶ ${label} … `);
  try {
    execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('OK');
  } catch (error) {
    console.log('ÉCHEC');
    console.error(String(error.stdout ?? '') + String(error.stderr ?? ''));
    console.error(`\nLivraison INTERROMPUE : « ${label} » a échoué. Aucun ZIP n’est produit.`);
    process.exit(1);
  }
}

/* ---------------- 5. Collecte des fichiers à livrer ---------------- */

const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'dist-electron', 'release', 'delivery',
  '.git', 'keys', 'coverage', '.cache', '.arena', '.turbo', '.vite'
]);
const PUBLIC_KEY = path.join('apps', 'teralynk', 'electron', 'signing-public-key.pem');

function isExcludedFile(relPath) {
  if (relPath.endsWith('.log')) return true;
  if (relPath.endsWith('.DS_Store')) return true;
  // Aucune clé privée ne doit partir : seul le PEM public embarqué est livré.
  if (relPath.endsWith('.pem') && relPath !== PUBLIC_KEY) return true;
  if (/^teralynk-.*\.zip$/.test(path.basename(relPath))) return true;
  return false;
}

function walk(dir, out = []) {
  for (const entry of readFileSyncNames(dir)) {
    const full = path.join(dir, entry);
    const rel = path.relative(root, full);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry)) walk(full, out);
    } else if (!isExcludedFile(rel)) {
      out.push(rel);
    }
  }
  return out;
}

function readFileSyncNames(dir) {
  return readdirSync(dir);
}

const files = walk(root).sort();

function sha256OfFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

const sums = files.map((rel) => `${sha256OfFile(path.join(root, rel))}  ${rel.replace(/\\/g, '/')}`);
const sumsText = sums.join('\n') + '\n';

const deliveryInfo = [
  `Teralynk — livraison source v${version}`,
  `Date            : ${new Date().toISOString()}`,
  `Node            : ${process.version}`,
  `Fichiers livrés : ${files.length}`,
  '',
  'Vérifications exécutées avant production de ce ZIP :',
  '  [OK] npm run typecheck        (TypeScript strict, 3 packages)',
  '  [OK] npx vitest run           (suite de tests automatisés)',
  '  [OK] build @teralynk/app      (renderer + processus Electron)',
  '  [OK] build @teralynk/admin    (renderer + processus Electron)',
  '',
  'Intégrité : SHA256SUMS.txt liste l’empreinte de chaque fichier livré.',
  'Aucune clé privée, aucun jeton, aucun node_modules, aucun build dans cette archive.',
  ''
].join('\n');

/* ---------------- Création du ZIP ---------------- */

const outDir = path.join(root, 'delivery');
mkdirSync(outDir, { recursive: true });
const outZip = path.join(outDir, `teralynk-v${version}.zip`);
if (existsSync(outZip)) rmSync(outZip);

const zipfile = new yazl.ZipFile();
for (const rel of files) {
  zipfile.addFile(path.join(root, rel), rel.replace(/\\/g, '/'));
}
zipfile.addBuffer(Buffer.from(sumsText, 'utf8'), 'SHA256SUMS.txt');
zipfile.addBuffer(Buffer.from(deliveryInfo, 'utf8'), 'DELIVERY_INFO.txt');
zipfile.end();

await new Promise((resolve, reject) => {
  const out = createWriteStream(outZip);
  zipfile.outputStream.pipe(out);
  out.on('close', resolve);
  out.on('error', reject);
  zipfile.outputStream.on('error', reject);
});

const zipSha = sha256OfFile(outZip);
const zipSize = statSync(outZip).size;

console.log('\n──────────────────────────────────────────────');
console.log(`ZIP livré        : ${path.relative(root, outZip)}`);
console.log(`Version          : v${version}`);
console.log(`Fichiers sources : ${files.length} (+ SHA256SUMS.txt, DELIVERY_INFO.txt)`);
console.log(`Taille           : ${(zipSize / 1048576).toFixed(2)} Mo`);
console.log(`SHA-256 du ZIP   : ${zipSha}`);
console.log('──────────────────────────────────────────────');
