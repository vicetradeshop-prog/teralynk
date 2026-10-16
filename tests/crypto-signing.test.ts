/**
 * Tests cryptographiques : empreintes SHA-256, comparaison en temps constant,
 * signature Ed25519 réelle (aller-retour, falsification, mauvaise clé).
 * (Exigence §19 : vérification de signature réelle, pas une comparaison de texte.)
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex, safeEqualHex, signManifest, verifyManifestSignature, generateSigningKeyPair } from '@teralynk/shared/node';

describe('sha256Hex', () => {
  it('produit l’empreinte attendue (vecteur connu)', () => {
    // "abc" → ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('est sensible au moindre changement', () => {
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });
});

describe('safeEqualHex', () => {
  it('compare sans sensibilité à la casse', () => {
    expect(safeEqualHex('ABCD1234', 'abcd1234')).toBe(true);
  });
  it('rejette des longueurs différentes', () => {
    expect(safeEqualHex('abcd', 'abcde')).toBe(false);
  });
  it('rejette des entrées non hexadécimales', () => {
    expect(safeEqualHex('zzzz', 'zzzz')).toBe(false);
  });
  it('rejette une différence d’un seul caractère', () => {
    expect(safeEqualHex('a'.repeat(64), `${'a'.repeat(63)}b`)).toBe(false);
  });
});

describe('Signature Ed25519 des manifestes', () => {
  const keys = generateSigningKeyPair();
  const payload = new TextEncoder().encode(JSON.stringify({ version: '1.0.0', channel: 'stable' }));

  it('vérifie une signature légitime', () => {
    const signature = signManifest(payload, keys.privateKeyPem);
    expect(verifyManifestSignature(payload, signature, keys.publicKeyPem)).toBe(true);
  });

  it('REJETTE un payload falsifié d’un octet', () => {
    const signature = signManifest(payload, keys.privateKeyPem);
    const tampered = new Uint8Array(payload);
    tampered[10] = tampered[10]! ^ 0xff;
    expect(verifyManifestSignature(tampered, signature, keys.publicKeyPem)).toBe(false);
  });

  it('REJETTE une signature produite par une autre clé privée', () => {
    const other = generateSigningKeyPair();
    const signature = signManifest(payload, other.privateKeyPem);
    expect(verifyManifestSignature(payload, signature, keys.publicKeyPem)).toBe(false);
  });

  it('REJETTE une signature tronquée ou corrompue', () => {
    const signature = signManifest(payload, keys.privateKeyPem);
    expect(verifyManifestSignature(payload, signature.slice(0, 20), keys.publicKeyPem)).toBe(false);
    expect(verifyManifestSignature(payload, 'pas-base64-valide!!', keys.publicKeyPem)).toBe(false);
  });

  it('REJETTE une signature vide', () => {
    expect(verifyManifestSignature(payload, '', keys.publicKeyPem)).toBe(false);
  });
});
