#!/usr/bin/env node
/**
 * Construit le paquet de publication Teralynk (ZIP) à partir d'artefacts
 * compilés localement — format documenté dans docs/admin.md §Publication.
 *
 * Usage :
 *   node scripts/make-package.mjs <dossier-artefacts> <version> [canal] [version-minimale]
 *
 * Exemple :
 *   npm run dist -w @teralynk/app
 *   node scripts/make-package.mjs apps/teralynk/release/win-unpacked-release 1.2.0 stable 1.0.0
 *
 * Le dossier doit contenir les artefacts produits par electron-builder
 * (ex. Teralynk-Setup-1.2.0.exe et latest.yml). Le script :
 *  1. vérifie leur présence ;
 *  2. calcule leurs empreintes SHA-256 ;
 *  3. écrit teralynk.package.json (métadonnées stables du paquet) ;
 *  4. produit teralynk-<version>-<canal>.zip prêt à être sélectionné
 *     dans Teralynk Admin → Versions → Publier une version.
 *
 * Aucune publication n'est effectuée ici : la publication passe exclusivement
 * par Teralynk Admin (jeton administrateur chiffré, jamais dans ce script).
 */
import { createReadStream, createWriteStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import yazl from 'yazl';

const [artifactsDir, version, channel = 'stable', minSupportedVersion = version] = process.argv.slice(2);

if (!artifactsDir || !version) {
  console.error('Usage : make-package.mjs <dossier-artefacts> <version> [canal] [version-minimale]');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/.test(version)) {
  console.error(`Version invalide (semver attendu) : ${version}`);
  process.exit(1);
}
if (!['stable', 'beta'].includes(channel)) {
  console.error(`Canal invalide (stable|beta) : ${channel}`);
  process.exit(1);
}

const dir = path.resolve(artifactsDir);
if (!existsSync(dir)) {
  console.error(`Dossier d'artefacts introuvable : ${dir}`);
  console.error('Construisez d’abord l’application : npm run dist -w @teralynk/app');
  process.exit(1);
}

/* 1. Détection des artefacts de distribution. */
const entries = readdirSync(dir).filter((name) => {
  const full = path.join(dir, name);
  return statSync(full).isFile();
});

const installer = entries.find((name) => /^Teralynk-Setup-.*\.exe$/i.test(name));
const updaterManifest = entries.find((name) => name === 'latest.yml' || name === 'latest-beta.yml');

if (!installer) {
  console.error('Aucun installateur détecté (Teralynk-Setup-*.exe).');
  console.error(`Contenu du dossier : ${entries.join(', ') || '(vide)'}`);
  console.error('Un paquet de publication doit contenir l’installateur NSIS — une archive source sera refusée par l’admin.');
  process.exit(1);
}

const files = [installer, ...(updaterManifest ? [updaterManifest] : [])];

/* 2. Empreintes SHA-256. */
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const manifest = {
  packageFormat: 1,
  app: 'teralynk',
  version,
  channel,
  files,
  ...(updaterManifest ? { updaterManifest } : {}),
  minSupportedVersion,
  title: `Teralynk ${version}`,
  notes: existsSync(path.join(dir, 'RELEASE_NOTES.md')) ? readFileSync(path.join(dir, 'RELEASE_NOTES.md'), 'utf8').trim().slice(0, 20000) : '',
  builtAt: new Date().toISOString()
};

console.log('Paquet de publication Teralynk');
console.log(`  version          : ${version} (canal ${channel})`);
console.log(`  minimale requise : ${minSupportedVersion}`);
for (const file of files) {
  const full = path.join(dir, file);
  const sha = await sha256OfFile(full);
  console.log(`  ${file} — ${(statSync(full).size / 1048576).toFixed(1)} Mo — sha256 ${sha.slice(0, 16)}…`);
}

/* 3. Écriture des métadonnées dans le dossier de staging. */
const staging = path.join(dir, '.package-staging');
writeFileSync(path.join(dir, 'teralynk.package.json'), JSON.stringify(manifest, null, 2), 'utf8');
void staging;

/* 4. Création du ZIP (racine plate : métadonnées + artefacts). */
const outZip = path.resolve(`teralynk-${version}-${channel}.zip`);
const zipfile = new yazl.ZipFile();
zipfile.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'teralynk.package.json');
for (const file of files) {
  zipfile.addFile(path.join(dir, file), file);
}
zipfile.end();

await new Promise((resolve, reject) => {
  const out = createWriteStream(outZip);
  zipfile.outputStream.pipe(out);
  out.on('close', resolve);
  out.on('error', reject);
  zipfile.outputStream.on('error', reject);
});

// Le fichier de métadonnées reste aussi à côté pour inspection ; le ZIP est autonome.
console.log(`\nPaquet prêt : ${outZip}`);
console.log('Sélectionnez-le dans Teralynk Admin → Versions et mises à jour → Publier une version.');

