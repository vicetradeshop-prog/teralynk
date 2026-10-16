/**
 * Tests d'assainissement des journaux (aucun secret dans les logs).
 * (Exigence §14 / §17 : journaux sans jetons ni secrets.)
 */
import { describe, expect, it } from 'vitest';
import { redactSecrets, maskToken } from '@teralynk/shared';

describe('redactSecrets', () => {
  it('masque les PAT GitHub classiques', () => {
    const out = redactSecrets('erreur avec ghp_1234567890abcdefghijklmnopqrstu dans le message');
    expect(out).not.toContain('ghp_1234567890abcdefghijklmnopqrstu');
    expect(out).toContain('[REDACTED_GITHUB_TOKEN]');
  });

  it('masque les fine-grained tokens', () => {
    const out = redactSecrets('token github_pat_11ABCDEFGHIJ0abcdefghijklmnopqrstuvwxyz utilisé');
    expect(out).not.toContain('github_pat_11ABCDEFGHIJ0abcdefghijklmnopqrstuvwxyz');
  });

  it('masque les en-têtes Authorization', () => {
    const out = redactSecrets('requête avec authorization: Bearer super-secret-value envoyée');
    expect(out).not.toContain('super-secret-value');
    expect(out).toContain('[REDACTED]');
  });

  it('masque les paramètres token/secret des URLs', () => {
    const out = redactSecrets('upload vers https://x.github.com/?token=abc123secret&name=f.exe');
    expect(out).not.toContain('abc123secret');
  });

  it('masque les clés privées PEM', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nBASE64BASE64\n-----END PRIVATE KEY-----';
    const out = redactSecrets(`clé : ${pem}`);
    expect(out).not.toContain('BASE64BASE64');
    expect(out).toContain('[REDACTED_PRIVATE_KEY]');
  });

  it('laisse passer un message sans secret', () => {
    const message = 'Publication du catalogue réussie (12 cartes)';
    expect(redactSecrets(message)).toBe(message);
  });
});

describe('maskToken', () => {
  it('ne montre que 4+4 caractères', () => {
    const masked = maskToken('ghp_1234567890abcdefghijklmnopqrstu');
    expect(masked.startsWith('ghp_')).toBe(true);
    expect(masked.endsWith('rstu')).toBe(true);
    expect(masked).not.toContain('abcdefghij');
  });

  it('masque totalement les jetons courts', () => {
    expect(maskToken('court')).toBe('••••');
  });
});
