#!/usr/bin/env node
/**
 * Correctif automatique : les versions récentes de npm peuvent bloquer les
 * scripts postinstall des dépendances (approbation « allowScripts »), dont
 * celui d'Electron qui télécharge son binaire. Sans ce binaire,
 * electron-builder échoue avec « Cannot compute electron version ».
 *
 * Ce postinstall du projet (autorisé, car c'est NOTRE script) détecte un
 * Electron installé sans binaire et exécute explicitement son install.js.
 * Rien n'est installé sans que la dépendance soit déjà déclarée : il s'agit
 * uniquement d'exécuter le script officiel d'un paquet déjà présent.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPkg = path.join(root, 'node_modules', 'electron');
const installJs = path.join(electronPkg, 'install.js');
const binaryMarker = path.join(electronPkg, 'path.txt'); // créé par l'install officielle

if (!existsSync(installJs)) {
  // Electron pas installé (ex. installation partielle) : rien à faire ici.
  process.exit(0);
}
if (existsSync(binaryMarker)) {
  // Binaire déjà présent : rien à faire.
  process.exit(0);
}

console.log('[postinstall] Binaire Electron absent (script de dépendance bloqué par npm) — exécution explicite de electron/install.js…');
try {
  execFileSync(process.execPath, [installJs], { cwd: electronPkg, stdio: 'inherit' });
  console.log('[postinstall] Binaire Electron installé.');
} catch (error) {
  console.error('[postinstall] Échec de l’installation du binaire Electron :', error.message);
  console.error('Solution manuelle : node node_modules/electron/install.js   (ou: npm install-scripts approve electron && npm rebuild electron)');
  process.exit(1);
}
