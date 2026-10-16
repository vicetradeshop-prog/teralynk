/**
 * Chargement de la clé publique Ed25519 embarquée dans l'application.
 * Partagée par la vérification des mises à jour et celle du contenu signé.
 */
import { app } from 'electron';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

let cachedKey: string | null = null;

/** Clé publique de signature embarquée — jamais une clé privée ici. */
export function embeddedPublicKey(): string {
  if (cachedKey) return cachedKey;
  const candidates = [
    path.join(__dirname, 'signing-public-key.pem'), // bundle esbuild (copié à côté)
    path.join(__dirname, '..', 'electron', 'signing-public-key.pem'), // dev
    path.join(process.resourcesPath ?? '', 'signing-public-key.pem') // paquet empaqueté
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        cachedKey = readFileSync(candidate, 'utf8');
        return cachedKey;
      }
    } catch {
      /* candidat suivant */
    }
  }
  void app; // app non requis ici mais conservé pour cohérence du module
  throw new Error('Clé publique de signature introuvable dans l’installation');
}
