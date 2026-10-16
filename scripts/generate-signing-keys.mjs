#!/usr/bin/env node
/**
 * Génère la paire de clés Ed25519 de signature des manifestes Teralynk.
 *
 *  - `teralynk-signing-private.pem` : à conserver UNIQUEMENT sur l'ordinateur
 *    administrateur (jamais committé, jamais distribué).
 *  - `teralynk-signing-public.pem`  : à intégrer dans l'application utilisateur
 *    (apps/teralynk/electron/signing-public-key.pem).
 *
 * Usage : node scripts/generate-signing-keys.mjs [répertoire-de-sortie]
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] ?? '.');
mkdirSync(outDir, { recursive: true });

const privatePath = path.join(outDir, 'teralynk-signing-private.pem');
const publicPath = path.join(outDir, 'teralynk-signing-public.pem');

if (existsSync(privatePath)) {
  console.error(`Refus d'écraser une clé existante : ${privatePath}`);
  console.error('Déplacez-la manuellement si vous voulez réellement régénérer une paire.');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
chmodSync(privatePath, 0o600);

console.log('Paire de clés Ed25519 générée :');
console.log(`  privée (ADMIN uniquement, ne jamais publier) : ${privatePath}`);
console.log(`  publique (à intégrer dans l'application)     : ${publicPath}`);
