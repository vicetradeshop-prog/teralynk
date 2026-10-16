/**
 * Primitives cryptographiques de Teralynk (Node uniquement — processus principal
 * de l'application et de l'admin). Aucune clé privée n'est intégrée aux builds
 * distribués ; voir docs/updates.md §Signature.
 */
import { createHash, sign as edSign, verify as edVerify, generateKeyPairSync } from 'node:crypto';

/** Empreinte SHA-256 hexadécimale (minuscules) d'un buffer. */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Comparaison en temps constant de deux empreintes hexadécimales. */
export function safeEqualHex(a: string, b: string): boolean {
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  if (na.length !== nb.length || !/^[a-f0-9]+$/.test(na) || !/^[a-f0-9]+$/.test(nb)) return false;
  let diff = 0;
  for (let i = 0; i < na.length; i++) diff |= na.charCodeAt(i) ^ nb.charCodeAt(i);
  return diff === 0;
}

/**
 * Signature Ed25519 detached d'un manifeste.
 * @param payload octets exacts du fichier JSON publié
 * @param privateKeyPem clé privée PEM (SPKI/PKCS8) — administrateur uniquement
 * @returns signature encodée en base64 (contenu du fichier `.sig`)
 */
export function signManifest(payload: Uint8Array, privateKeyPem: string): string {
  const signature = edSign(null, Buffer.from(payload), privateKeyPem);
  return signature.toString('base64');
}

/**
 * Vérification Ed25519 réelle d'un manifeste signé.
 * @returns true uniquement si la signature correspond au contenu ET à la clé publique embarquée.
 */
export function verifyManifestSignature(payload: Uint8Array, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const signature = Buffer.from(signatureBase64.trim(), 'base64');
    if (signature.length !== 64) return false;
    return edVerify(null, Buffer.from(payload), publicKeyPem, signature);
  } catch {
    return false;
  }
}

/** Génération d'une paire de clés Ed25519 (utilisée par scripts/generate-signing-keys.mjs). */
export function generateSigningKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  };
}
